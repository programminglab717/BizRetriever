import { AiError, type LLMProvider } from '@bizr/ai';
import { planRecordWrite as prompt, type RecordCatalog } from '@bizr/ai/prompts';
import { getLogger } from '@bizr/platform';

import { getAiProvider } from '../ai/runtime';
import { loadCatalog } from '../change-plan/apply';
import type { CatalogEntity } from '../change-plan/compile';
import { executeTenantQuery } from '../executor/execute';
import { ident } from '../sql/ident';
import type { MemberWorkspace } from '../workspaces/service';
import { bestMatches, words } from './lookup';
import { RecordsError } from './service';
import { titleFieldOf } from './values';
import {
  lookupRecords,
  prepareRecordWrite,
  recordWritePlanSchema,
  type RecordWritePlan,
  type WriteCard,
} from './write';
import { draftWithRules, type Draft, type DraftPart } from './write-rules';

/**
 * "Add a sale: 5 Sage mugs to Bloom & Co today" (Task H): rules first, then the AI. Names are looked
 * up in the owner's records; unclear ones get a question; new people and places are created only when
 * shown on the card. The plan is checked and the card rendered by code.
 */

export type WriteOutcome =
  | { kind: 'plan'; plan: RecordWritePlan; card: WriteCard; origin: 'rules' | 'ai' }
  | { kind: 'clarify'; question: string; mention: string; options: { label: string; id: string }[] }
  | { kind: 'none'; message: string };

export const CANT_WRITE =
  'I couldn’t work out what to add or change. Try “Add a sale: 5 Sage mugs to Bloom & Co today” or “Change the price of Sage Stoneware Mug to $20”.';

/** Record types that can be created on the fly when a name isn't found (shown on the card). */
const CREATABLE = new Set(['customer', 'supplier', 'location']);

const log = () => getLogger('records.plan');

const todayIn = (tz: string, now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

class Clarify extends Error {
  constructor(
    readonly question: string,
    readonly mention: string,
    readonly options: { label: string; id: string }[],
  ) {
    super(question);
  }
}

/** Mentions → ids (or new records); throws Clarify or RecordsError. */
async function resolveDraft(
  member: MemberWorkspace,
  catalog: readonly CatalogEntity[],
  draft: Draft,
  choices: Readonly<Record<string, string>>,
): Promise<RecordWritePlan> {
  const resolve = async (entityKey: string, mention: string, creatable: boolean) => {
    const e = catalog.find((x) => x.key === entityKey);
    if (!e) throw new RecordsError(CANT_WRITE);
    const chosen = choices[mention];
    if (chosen) return { candidateId: chosen };
    const found = await lookupRecords(member, e, mention);
    if (found.length === 1) return { candidateId: found[0]!.id };
    if (found.length > 1)
      throw new Clarify(
        `Which ${e.label.singular.toLowerCase()} do you mean by “${mention}”?`,
        mention,
        found.map((c) => ({ label: c.title, id: c.id })),
      );
    const title = titleFieldOf(e.fields);
    if (creatable && CREATABLE.has(e.key) && title)
      return { createNew: { values: { [title]: mention } } };
    throw new RecordsError(
      `I couldn’t find a ${e.label.singular.toLowerCase()} called “${mention}”.`,
    );
  };
  const refs = async (part: DraftPart, creatable: boolean) => {
    const e = catalog.find((x) => x.key === part.entity)!;
    const out: RecordWritePlan['records'][number]['references'] = {};
    for (const [field, mention] of Object.entries(part.mentions)) {
      const f = e.fields.find((x) => x.key === field);
      if (!f?.references) throw new RecordsError(CANT_WRITE);
      out[field] = await resolve(f.references, mention, creatable);
    }
    return out;
  };
  if (draft.operation === 'update') {
    const target = await resolve(draft.entity, draft.target, false);
    if (!('candidateId' in target)) throw new RecordsError(CANT_WRITE);
    return {
      operation: 'update',
      entity: draft.entity,
      records: [
        {
          id: target.candidateId,
          values: draft.values,
          references: await refs(draft, true),
          lines: [],
        },
      ],
      assumptions: [],
    };
  }
  const lines: RecordWritePlan['records'][number]['lines'] = [];
  for (const l of draft.lines)
    lines.push({ entity: l.entity, values: l.values, references: await refs(l, false) });
  return {
    operation: 'insert',
    entity: draft.entity,
    records: [{ values: draft.values, references: await refs(draft, true), lines }],
    assumptions: [],
  };
}

export async function planRecordWrite(
  member: MemberWorkspace,
  request: string,
  options: {
    provider?: LLMProvider | null;
    aiMode?: 'auto' | 'never';
    /** Answers to "Which … do you mean": what was typed → the record chosen. */
    choices?: Record<string, string>;
    now?: Date;
  } = {},
): Promise<WriteOutcome> {
  const text = request.trim().slice(0, 400);
  if (!text) return { kind: 'none', message: CANT_WRITE };
  const catalog = await loadCatalog(member.workspace.id);
  const now = options.now ?? new Date();
  const today = todayIn(member.settings.timezone, now);
  const choices = options.choices ?? {};

  const draft = draftWithRules(text, catalog, { today });
  let ruleProblem: string | null = null;
  if (draft) {
    try {
      const plan = await resolveDraft(member, catalog, draft, choices);
      const { card } = await prepareRecordWrite(member, plan, now);
      return { kind: 'plan', plan, card, origin: 'rules' };
    } catch (err) {
      if (err instanceof Clarify)
        return {
          kind: 'clarify',
          question: err.question,
          mention: err.mention,
          options: err.options,
        };
      if (!(err instanceof RecordsError)) throw err;
      ruleProblem = err.message;
    }
  }
  const provider = options.provider === undefined ? getAiProvider() : options.provider;
  if (provider && options.aiMode !== 'never') {
    const out = await planWithAi(member, catalog, text, today, provider, now);
    if (out) return out;
  }
  return { kind: 'none', message: ruleProblem ?? CANT_WRITE };
}

export function recordCatalog(catalog: readonly CatalogEntity[]): RecordCatalog {
  return {
    entities: catalog.map((e) => ({
      id: e.key,
      label: e.label.singular,
      fields: e.fields
        .filter((f) => !f.pii)
        .map((f) => ({
          id: f.key,
          label: f.label,
          type: f.type,
          ...(f.required ? { required: true } : {}),
          ...(f.references ? { references: f.references } : {}),
          ...(f.allowedValues ? { allowedValues: f.allowedValues } : {}),
        })),
      ...(() => {
        const lines = catalog
          .filter(
            (x) => x.key.startsWith(`${e.key}_`) && x.fields.some((f) => f.references === e.key),
          )
          .map((x) => x.key);
        return lines.length ? { lines } : {};
      })(),
    })),
  };
}

/** Records named in the request (by every word of their name), for the AI to choose from. */
async function candidatesFor(
  member: MemberWorkspace,
  catalog: readonly CatalogEntity[],
  request: string,
) {
  const asked = new Set(words(request));
  const out: Record<string, { id: string; title: string }[]> = {};
  for (const e of catalog) {
    if (!titleFieldOf(e.fields)) continue;
    let rows: { id: string; title: string }[];
    try {
      const all = await lookupAll(member, e);
      rows = all.filter((r) => {
        const w = words(r.title);
        return w.length > 0 && w.filter((x) => asked.has(x)).length >= Math.min(2, w.length);
      });
    } catch {
      continue;
    }
    const best = rows
      .map((r) => ({ ...r, score: bestMatches(request, [r])[0]?.score ?? 0 }))
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, 5)
      .map(({ id, title }) => ({ id, title }));
    if (best.length) out[e.key] = best;
  }
  return out;
}

async function lookupAll(member: MemberWorkspace, e: CatalogEntity) {
  const t = titleFieldOf(e.fields)!;
  const r = await executeTenantQuery({
    tenant: { workspaceId: member.workspace.id, tenantSchema: member.workspace.tenantSchema },
    sql: `SELECT "_id"::text AS id, ${ident(t)}::text AS title FROM ${ident(e.tableName)} WHERE "_deleted_at" IS NULL AND ${ident(t)} IS NOT NULL`,
    origin: 'records',
    path: 'system',
    rowLimit: 20_000,
  });
  return r.rows.map((x) => ({ id: String(x.id as string), title: String(x.title as string) }));
}

async function planWithAi(
  member: MemberWorkspace,
  catalog: readonly CatalogEntity[],
  request: string,
  today: string,
  provider: LLMProvider,
  now: Date,
): Promise<WriteOutcome | null> {
  const candidates = await candidatesFor(member, catalog, request);
  const known = new Set(Object.values(candidates).flatMap((list) => list.map((c) => c.id)));
  let last: { answer: RecordWritePlan; problems: string[] } | undefined;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const built = prompt.build({
        catalog: recordCatalog(catalog),
        settings: { today, currency: member.settings.currency },
        data: { candidates, ...(last ? { lastAnswer: last.answer, problems: last.problems } : {}) },
        request,
      });
      const res = await provider.generate({
        task: prompt.task,
        promptVersion: prompt.version,
        tier: 'standard',
        effort: 'low',
        system: prompt.system,
        ...built,
        schema: recordWritePlanSchema,
        maxTokens: 3_000,
        workspaceId: member.workspace.id,
      });
      const plan = res.data;
      if (plan.clarify) return { kind: 'none', message: plan.clarify.question };
      const problems: string[] = [];
      const ids = plan.records.flatMap((r) => [
        ...(r.id ? [r.id] : []),
        ...[r.references, ...r.lines.map((l) => l.references)].flatMap((refs) =>
          Object.values(refs).flatMap((x) => ('candidateId' in x ? [x.candidateId] : [])),
        ),
      ]);
      for (const id of ids)
        if (!known.has(id)) problems.push(`id ${id} is not one of the candidates`);
      if (!problems.length) {
        try {
          const { card } = await prepareRecordWrite(member, plan, now);
          return { kind: 'plan', plan, card, origin: 'ai' };
        } catch (err) {
          if (!(err instanceof RecordsError)) throw err;
          problems.push(err.message);
        }
      }
      log().info({ problems }, 'AI record write rejected');
      last = { answer: plan, problems };
    }
    return null;
  } catch (err) {
    if (err instanceof AiError) return null;
    throw err;
  }
}
