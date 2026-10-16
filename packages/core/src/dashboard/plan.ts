import { AiError, type LLMProvider } from '@bizr/ai';
import { planDashboardEdit as prompt } from '@bizr/ai/prompts';
import { getPack } from '@bizr/packs';
import { getLogger } from '@bizr/platform';

import { getAiProvider } from '../ai/runtime';
import { loadAskContext, type AskContext } from '../ask/catalog';
import { findJargon } from '../narration';
import type { MemberWorkspace } from '../workspaces/service';
import {
  applyOps,
  DashboardEditError,
  editPlanSchema,
  type DashboardSnapshot,
  type EditOp,
  type EditPlan,
} from './model';
import { planWithRules, type PlanContext } from './plan-rules';
import {
  currentDashboard,
  currentRange,
  editProblems,
  renderTiles,
  type TileView,
} from './service';

/**
 * "Change this dashboard" (Task G): rules first, then the AI. Every plan is checked (tiles exist,
 * every question compiles and is available, it applies cleanly) and previewed; nothing is saved
 * until the owner applies it, and the apply checks it all again.
 */

export type PlanOutcome =
  | {
      kind: 'plan';
      ops: EditOp[];
      changes: string[];
      /** The new or changed tiles, run for the current dates. */
      preview: TileView[];
      origin: 'rules' | 'ai';
    }
  | { kind: 'clarify'; question: string; options: { label: string; tileId: string }[] }
  | { kind: 'none'; message: string };

export const CANT_EDIT =
  'I couldn’t work out that change. Try something like “Add a chart of sales by city”, “Remove the top customers list” or “Show sales over time monthly”.';

const log = () => getLogger('dashboard.plan');

function planContext(ask: AskContext): PlanContext {
  return {
    catalog: ask.catalog,
    labels: {
      metric: (id) => ask.catalog.metrics.find((m) => m.id === id)?.label ?? id,
      dimension: (f) => ask.catalog.dimensions.find((d) => d.field === f)?.label ?? f,
    },
  };
}

/** Problems with a plan, or none. Never throws. */
async function planProblems(
  member: MemberWorkspace,
  snapshot: DashboardSnapshot,
  plan: EditPlan,
  ask: AskContext,
): Promise<string[]> {
  const problems = await editProblems(member, plan.ops, ask);
  try {
    applyOps(snapshot, plan.ops);
  } catch (err) {
    if (err instanceof DashboardEditError)
      problems.push('an edit names a tile that isn’t on the dashboard');
    else throw err;
  }
  return problems;
}

export async function planDashboardEdit(
  member: MemberWorkspace,
  request: string,
  options: {
    provider?: LLMProvider | null;
    aiMode?: 'auto' | 'never';
    /** The tile the owner picked after "Which one…?". */
    tileId?: string;
  } = {},
): Promise<PlanOutcome> {
  const text = request.trim().slice(0, 300);
  if (!text) return { kind: 'none', message: CANT_EDIT };
  const [snapshot, ask] = await Promise.all([currentDashboard(member), loadAskContext(member)]);
  const ctx = planContext(ask);

  const picked = options.tileId ? snapshot.tiles.filter((t) => t.id === options.tileId) : [];
  let plan: EditPlan | null = planWithRules(text, picked.length ? picked : snapshot.tiles, ctx);
  let origin: 'rules' | 'ai' = 'rules';
  if (plan && !plan.clarify && (await planProblems(member, snapshot, plan, ask)).length)
    plan = null;

  if (!plan) {
    const provider = options.provider === undefined ? getAiProvider() : options.provider;
    if (provider && options.aiMode !== 'never') {
      plan = await planWithAi(member, text, snapshot, ask, provider);
      origin = 'ai';
    }
  }
  if (!plan) return { kind: 'none', message: CANT_EDIT };
  if (plan.clarify) {
    // Options name tiles: send their ids so the choice can be planned exactly.
    const options = plan.clarify.options.flatMap((title) => {
      const t = snapshot.tiles.find((x) => x.title === title);
      return t ? [{ label: title, tileId: t.id }] : [];
    });
    return options.length >= 2
      ? { kind: 'clarify', question: plan.clarify.question, options }
      : { kind: 'none', message: CANT_EDIT };
  }
  if (plan.ops.length === 0) return { kind: 'none', message: plan.summary || CANT_EDIT };

  // Preview: the tiles this adds or changes, run for the dates the dashboard is showing.
  const { snapshot: after, changes } = applyOps(snapshot, plan.ops);
  const before = new Map(snapshot.tiles.map((t) => [t.id, JSON.stringify(t)]));
  const changed = after.tiles.filter((t) => before.get(t.id) !== JSON.stringify(t));
  const preview = await renderTiles(member, changed.slice(0, 3), await currentRange(member));
  return { kind: 'plan', ops: plan.ops, changes, preview, origin };
}

async function planWithAi(
  member: MemberWorkspace,
  request: string,
  snapshot: DashboardSnapshot,
  ask: AskContext,
  provider: LLMProvider,
): Promise<EditPlan | null> {
  const ws = member.workspace;
  const pack = getPack(ws.packId);
  const refs = new Map(snapshot.tiles.map((t, i) => [`t${i + 1}`, t.id]));
  const toIds = (plan: EditPlan): EditPlan => {
    const id = (ref: string) => refs.get(ref) ?? ref;
    return {
      ...plan,
      ops: plan.ops.map((o) => {
        const pos =
          'position' in o && o.position && typeof o.position === 'object'
            ? { position: { after: id(o.position.after) } }
            : {};
        return 'tileId' in o ? { ...o, tileId: id(o.tileId), ...pos } : { ...o, ...pos };
      }),
    };
  };
  const packLabel = new Map(pack.metrics.metrics.map((m) => [m.id, m.label]));
  let last: { answer: EditPlan; problems: string[] } | undefined;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const built = prompt.build({
        primer: pack.primer,
        catalog: {
          measures: pack.metrics.metrics.map((m) => ({
            id: m.id,
            label: m.label,
            description: m.description,
            format: m.format,
            snapshot: m.snapshot,
            synonyms: m.synonyms,
          })),
          breakdowns: pack.metrics.dimensions.map((d) => ({
            field: d.field,
            label: d.label,
            synonyms: d.synonyms,
          })),
        },
        settings: { ...ask.catalog.calendar, currency: ask.catalog.currency },
        unavailable: ask.catalog.metrics
          .filter((m) => !m.available)
          .map((m) => ({ id: m.id, reason: m.reason ?? 'Not in your data yet.' })),
        data: {
          tiles: snapshot.tiles.map((t, i) => ({
            ref: `t${i + 1}`,
            title: t.title,
            chart: t.chart,
            spec: t.spec,
            fixedDates: t.fixedDates,
          })),
          values: Object.fromEntries(
            ask.catalog.dimensions.map((d) => [d.field, d.values.slice(0, 100)]),
          ),
          renamed: Object.fromEntries(
            ask.catalog.metrics
              .filter((m) => m.label !== packLabel.get(m.id))
              .map((m) => [m.id, m.label]),
          ),
          ...(last ? { lastAnswer: last.answer, problems: last.problems } : {}),
        },
        request,
      });
      const res = await provider.generate({
        task: prompt.task,
        promptVersion: prompt.version,
        tier: 'standard',
        effort: 'low',
        system: prompt.system,
        ...built,
        schema: editPlanSchema,
        maxTokens: 4_000,
        workspaceId: ws.id,
      });
      const plan = toIds(res.data);
      const problems = plan.clarify ? [] : await planProblems(member, snapshot, plan, ask);
      if (findJargon(plan.summary).length || /\d/.test(plan.summary)) plan.summary = ''; // our own change list is shown instead
      if (problems.length === 0) return plan;
      log().info({ problems }, 'AI dashboard edit rejected');
      last = { answer: res.data, problems };
    }
    return null;
  } catch (err) {
    if (err instanceof AiError) return null;
    throw err;
  }
}
