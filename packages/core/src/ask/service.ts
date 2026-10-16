import type { LLMProvider } from '@bizr/ai';
import { answer, conversation, dashboardTile, getAppDb, type AnswerKind } from '@bizr/db';
import { getPack, type PackQuestion } from '@bizr/packs';
import { getLogger } from '@bizr/platform';
import { and, asc, desc, eq } from 'drizzle-orm';

import type { CatalogEntity } from '../change-plan/compile';
import { draftWithRules } from '../records/write-rules';
import { planChangeWithRules } from '../structure/plan-rules';
import { getAiProvider } from '../ai/runtime';
import { enrichedViewName } from '../change-plan/views';
import { QueryExecutionError } from '../executor/execute';
import { renderTemplate, type FormatOptions, type Segment } from '../narration';
import { SemanticError } from '../semantic/graph';
import { runFallbackSql } from '../semantic/fallback';
import { compileContext, runQuery } from '../semantic/service';
import type { MemberWorkspace } from '../workspaces/service';
import {
  answerFacts,
  chooseChart,
  explainSpec,
  templateAnswer,
  toAnswerData,
  type AnswerColumn,
  type AnswerData,
  type Cell,
} from './answer';
import { loadAskContext, type AskContext } from './catalog';
import { interpret, type InterpretOrigin, type Turn } from './interpret';
import {
  interpretationSchema,
  periodOf,
  titleFor,
  toQuerySpec,
  type ChartType,
  type Interpretation,
} from './interpretation';
import { applyDashboardEdit, currentDashboard } from '../dashboard/service';
import { explainFallbackSql, narrate } from './narrate';
import { periodLabel } from './time';
import { localeFor } from './view';

/**
 * Ask (PRODUCT_SPEC §2.1): one question in, one stored answer out. Interprets (rules, then AI),
 * runs the spec or validated SQL as the tenant's reader, turns the result into facts, a sentence
 * and a chart, and saves it to the conversation.
 */

export const STORED_ROWS = 200;
const HISTORY = 6;
/** Read by the same rules My data uses for adding and changing things. */
function isChangeRequest(
  question: string,
  entities: readonly CatalogEntity[],
  today: string,
): boolean {
  if (draftWithRules(question, entities, { today })) return true;
  const change = planChangeWithRules(question, entities);
  return Boolean(change && !('clarify' in change && /already track/.test(change.clarify)));
}

const log = () => getLogger('ask');

/** What the Ask screen shows for one answer. Written by code; every number comes from `data`. */
export interface AnswerContent {
  title: string;
  /** The headline, with facts filled in (fact segments are shown in bold). */
  headline?: Segment[];
  data?: AnswerData;
  chart?: ChartType;
  /** "How I calculated this". */
  steps?: string[];
  assumptions: string[];
  details?: { sql: string; custom: boolean; rows: number };
  clarify?: { question: string; options: string[] };
  unanswerable?: { reason: string; message: string; missing: string[] };
  error?: string;
  /** The question named its own dates ("March 2026"): a pinned tile keeps them. */
  fixedDates?: boolean;
  /** Whether the AI wrote the headline (for evals). */
  narration?: 'ai' | 'template';
  /** The period a comparison was made with ("August 2026"). */
  comparedWith?: string;
}

export interface AskResult {
  conversationId: string;
  answerId: string;
  question: string;
  kind: AnswerKind;
  origin: InterpretOrigin;
  content: AnswerContent;
  feedback: number | null;
  pinned: boolean;
  createdAt: Date;
}

export interface AskOptions {
  provider?: LLMProvider | null;
  aiMode?: 'auto' | 'never';
}

export class AskError extends Error {}

export { localeFor };

/** Ask a question, or pick an option of an earlier clarifying question (`choice`). */
export async function askQuestion(
  member: MemberWorkspace,
  userId: string | null,
  input: {
    question: string;
    conversationId?: string;
    choice?: { answerId: string; option: number };
  },
  options: AskOptions = {},
): Promise<AskResult> {
  const started = Date.now();
  const ws = member.workspace;
  const db = getAppDb();
  const question = input.question.trim().slice(0, 500);
  if (!question && !input.choice) throw new AskError('Ask a question first.');

  const conv = input.conversationId
    ? await loadConversation(ws.id, input.conversationId)
    : (
        await db
          .insert(conversation)
          .values({ workspaceId: ws.id, userId, title: question.slice(0, 120) || 'Question' })
          .returning()
      )[0]!;
  const history = await loadHistory(conv.id);
  const ctx = await loadAskContext(member);
  const provider = options.provider === undefined ? getAiProvider() : options.provider;
  const aiMode = options.aiMode ?? 'auto';

  let interpretation: Interpretation;
  let origin: InterpretOrigin;
  let aiCalls = 0;
  let asked = question;
  if (input.choice) {
    const picked = await chosenOption(conv.id, input.choice);
    interpretation = picked.interpretation;
    asked = picked.label;
    origin = 'rules';
  } else if (isChangeRequest(question, ctx.model.entities, ctx.catalog.calendar.today)) {
    // "Add a sale…", "Rename sales to orders": done in My data, not answered (M6).
    interpretation = {
      kind: 'unanswerable',
      reason: 'change_request',
      missing: [],
      message: 'That sounds like a change to your data, not a question.',
    };
    origin = 'rules';
  } else {
    const out = await interpret({
      question,
      catalog: ctx.catalog,
      model: ctx.model,
      compile: compileContext(member),
      pack: getPack(ws.packId),
      tenantSchema: ws.tenantSchema,
      history,
      provider,
      aiMode,
      workspaceId: ws.id,
    });
    interpretation = out.interpretation;
    origin = out.origin;
    aiCalls = out.aiCalls;
    if (out.note) log().info({ origin, note: out.note }, 'interpretation');
  }

  const rendered = await render(member, ctx, asked, interpretation, { provider, aiMode });
  aiCalls += rendered.aiCalls;
  const [row] = await db
    .insert(answer)
    .values({
      conversationId: conv.id,
      workspaceId: ws.id,
      userId,
      question: asked,
      kind: rendered.kind,
      origin,
      interpretation,
      content: rendered.content,
      latencyMs: Date.now() - started,
      aiCalls,
    })
    .returning();
  await db.update(conversation).set({ updatedAt: new Date() }).where(eq(conversation.id, conv.id));
  return toResult(row!, false);
}

async function loadConversation(workspaceId: string, id: string) {
  const [row] = await getAppDb()
    .select()
    .from(conversation)
    .where(and(eq(conversation.id, id), eq(conversation.workspaceId, workspaceId)));
  if (!row) throw new AskError('That conversation isn’t in this business.');
  return row;
}

async function loadHistory(conversationId: string): Promise<Turn[]> {
  const rows = await getAppDb()
    .select({ question: answer.question, interpretation: answer.interpretation })
    .from(answer)
    .where(eq(answer.conversationId, conversationId))
    .orderBy(desc(answer.createdAt))
    .limit(HISTORY);
  return rows.reverse().flatMap((r) => {
    const i = interpretationSchema.safeParse(r.interpretation);
    return i.success ? [{ question: r.question, interpretation: i.data }] : [];
  });
}

async function chosenOption(
  conversationId: string,
  choice: { answerId: string; option: number },
): Promise<{ interpretation: Interpretation; label: string }> {
  const [row] = await getAppDb()
    .select()
    .from(answer)
    .where(and(eq(answer.id, choice.answerId), eq(answer.conversationId, conversationId)));
  const i = row ? interpretationSchema.safeParse(row.interpretation) : undefined;
  const opt = i?.success && i.data.kind === 'clarify' ? i.data.options[choice.option] : undefined;
  if (!opt) throw new AskError('That choice isn’t available any more.');
  return {
    label: opt.label,
    interpretation: {
      kind: 'query',
      spec: opt.spec,
      assumptions: [`I took it to mean “${opt.label.toLowerCase()}”.`, ...opt.assumptions].slice(
        0,
        5,
      ),
    },
  };
}

// --- Rendering -----------------------------------------------------------------------------------

interface Rendered {
  kind: AnswerKind;
  content: AnswerContent;
  aiCalls: number;
}

async function render(
  member: MemberWorkspace,
  ctx: AskContext,
  question: string,
  i: Interpretation,
  ai: { provider: LLMProvider | null; aiMode: 'auto' | 'never' },
): Promise<Rendered> {
  const ws = member.workspace;
  const cal = ctx.catalog.calendar;
  const fmt: FormatOptions = {
    locale: localeFor(member.settings),
    currency: member.settings.currency,
  };
  const labels = {
    metric: (id: string) => ctx.catalog.metrics.find((m) => m.id === id)?.label ?? id,
    dimension: (ref: string) => ctx.catalog.dimensions.find((d) => d.field === ref)?.label ?? ref,
  };
  switch (i.kind) {
    case 'clarify':
      return {
        kind: 'clarify',
        aiCalls: 0,
        content: {
          title: i.question,
          assumptions: [],
          clarify: { question: i.question, options: i.options.map((o) => o.label) },
        },
      };
    case 'unanswerable':
      return {
        kind: 'unanswerable',
        aiCalls: 0,
        content: {
          title: question,
          assumptions: [],
          unanswerable: { reason: i.reason, message: i.message, missing: i.missing },
        },
      };
    case 'query': {
      const spec = i.spec;
      const title = titleFor(spec, cal, labels);
      try {
        const result = await runQuery(member, toQuerySpec(spec, cal), 'ask', ctx.model);
        const data = cap(toAnswerData(result));
        const period = periodOf(spec.timeRange, cal);
        const snapshot = spec.metrics.every(
          (id) => ctx.catalog.metrics.find((m) => m.id === id)?.snapshot,
        );
        const factCtx = {
          catalog: ctx.catalog,
          spec,
          ...(period && !snapshot ? { period } : {}),
          ...(result.previousPeriod ? { previousPeriod: result.previousPeriod } : {}),
        };
        const facts = answerFacts(data, factCtx);
        const assumptions = [...new Set([...i.assumptions, ...result.assumptions])];
        const narration = await narrate({
          question,
          data,
          facts,
          fallback: templateAnswer(data, facts, factCtx),
          assumptions,
          ...ai,
          workspaceId: ws.id,
        });
        return {
          kind: 'query',
          aiCalls: narration.aiCalls,
          content: {
            title,
            headline: renderTemplate(narration.template, facts.facts, fmt),
            narration: narration.origin,
            data,
            chart: chooseChart(data, spec, i.chart),
            steps: explainSpec(spec, { ...factCtx, metrics: ctx.catalog.metrics, assumptions: [] }),
            assumptions,
            details: { sql: result.sql, custom: false, rows: data.totalRows },
            fixedDates: !('preset' in spec.timeRange),
            ...(result.previousPeriod ? { comparedWith: periodLabel(result.previousPeriod) } : {}),
          },
        };
      } catch (err) {
        return failed(err, title);
      }
    }
    case 'sql': {
      const run = await runFallbackSql(ws, i.sql, { rowLimit: 1_000, timeoutMs: 8_000 });
      if (!run.ok) {
        log().warn({ reason: run.reason }, 'fallback SQL refused');
        return {
          kind: 'error',
          aiCalls: 0,
          content: { title: question, assumptions: [], error: run.userMessage },
        };
      }
      const data = cap(fallbackData(run.result.rows, run.result.fields));
      const factCtx = { catalog: ctx.catalog, spec: {} };
      const facts = answerFacts(data, factCtx);
      const records = Object.fromEntries(
        ctx.model.entities.flatMap((e) => {
          const label = e.label.plural.toLowerCase();
          const view = enrichedViewName(e.tableName);
          return [[e.tableName, label] as const, ...(view ? [[view, label] as const] : [])];
        }),
      );
      const [narration, explanation] = await Promise.all([
        narrate({
          question,
          data,
          facts,
          fallback: data.rows.length
            ? 'Here’s what I found.'
            : 'I didn’t find any records for this.',
          assumptions: i.assumptions,
          ...ai,
          workspaceId: ws.id,
        }),
        explainFallbackSql({ sql: run.sql, records, ...ai, workspaceId: ws.id }),
      ]);
      return {
        kind: 'sql',
        aiCalls: narration.aiCalls + (explanation.origin === 'ai' ? 1 : 0),
        content: {
          title: question,
          headline: renderTemplate(narration.template, facts.facts, fmt),
          narration: narration.origin,
          data,
          chart: chooseChart(data, { having: [] }),
          steps: explanation.steps,
          assumptions: i.assumptions,
          details: { sql: run.sql, custom: true, rows: data.totalRows },
        },
      };
    }
  }
}

function failed(err: unknown, title: string): Rendered {
  const message =
    err instanceof QueryExecutionError || err instanceof SemanticError
      ? err.userMessage
      : undefined;
  if (!message) throw err;
  log().warn({ err }, 'answer failed');
  return { kind: 'error', aiCalls: 0, content: { title, assumptions: [], error: message } };
}

function cap(data: AnswerData): AnswerData {
  if (data.rows.length <= STORED_ROWS) return data;
  return { ...data, rows: data.rows.slice(0, STORED_ROWS), truncated: true };
}

const NUMERIC_TYPES = new Set([20, 21, 23, 700, 701, 1700]);
const DATE_TYPES = new Set([1082, 1114, 1184]);

/** Columns of a fallback result: numbers are measures, dates are days, the rest are breakdowns. */
function fallbackData(
  rows: readonly Record<string, unknown>[],
  fields: readonly { name: string; dataTypeId: number }[],
): AnswerData {
  const human = (name: string) => {
    const s = name.replace(/_+/g, ' ').trim();
    return s ? `${s[0]!.toUpperCase()}${s.slice(1)}` : 'Value';
  };
  const columns: AnswerColumn[] = fields.map((f, n) =>
    NUMERIC_TYPES.has(f.dataTypeId)
      ? { key: f.name, label: human(f.name), kind: 'metric', format: 'number', metric: `c${n}` }
      : DATE_TYPES.has(f.dataTypeId)
        ? { key: f.name, label: human(f.name), kind: 'dimension', time: 'day' }
        : { key: f.name, label: human(f.name), kind: 'dimension' },
  );
  const toCell = (c: AnswerColumn, v: unknown): Cell => {
    if (v === null || v === undefined) return null;
    if (c.kind === 'metric') {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    if (v instanceof Date) {
      const p = (x: number) => String(x).padStart(2, '0');
      return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
    }
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    return JSON.stringify(v) ?? null;
  };
  return {
    columns,
    rows: rows.map((r) => Object.fromEntries(columns.map((c) => [c.key, toCell(c, r[c.key])]))),
    totalRows: rows.length,
    truncated: false,
  };
}

// --- Reading back, feedback, pins -----------------------------------------------------------------

function toResult(row: typeof answer.$inferSelect, pinned: boolean): AskResult {
  return {
    conversationId: row.conversationId,
    answerId: row.id,
    question: row.question,
    kind: row.kind,
    origin: row.origin as InterpretOrigin,
    content: row.content as AnswerContent,
    feedback: row.feedback,
    pinned,
    createdAt: row.createdAt,
  };
}

export async function getConversation(
  member: MemberWorkspace,
  conversationId: string,
): Promise<AskResult[]> {
  await loadConversation(member.workspace.id, conversationId);
  const db = getAppDb();
  const rows = await db
    .select()
    .from(answer)
    .where(eq(answer.conversationId, conversationId))
    .orderBy(asc(answer.createdAt));
  const pinned = new Set(
    (
      await db
        .select({ id: dashboardTile.sourceAnswerId })
        .from(dashboardTile)
        .where(eq(dashboardTile.workspaceId, member.workspace.id))
    ).map((r) => r.id),
  );
  return rows.map((r) => toResult(r, pinned.has(r.id)));
}

export async function recentConversations(member: MemberWorkspace, limit = 10) {
  return getAppDb()
    .select({ id: conversation.id, title: conversation.title, updatedAt: conversation.updatedAt })
    .from(conversation)
    .where(eq(conversation.workspaceId, member.workspace.id))
    .orderBy(desc(conversation.updatedAt))
    .limit(limit);
}

export const FEEDBACK_REASONS = [
  'wrong_numbers',
  'misunderstood',
  'wrong_period',
  'hard_to_read',
  'other',
] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export async function setAnswerFeedback(
  member: MemberWorkspace,
  answerId: string,
  value: 1 | -1 | null,
  reason?: FeedbackReason,
): Promise<void> {
  const updated = await getAppDb()
    .update(answer)
    .set({ feedback: value, feedbackReason: value === -1 ? (reason ?? null) : null })
    .where(and(eq(answer.id, answerId), eq(answer.workspaceId, member.workspace.id)))
    .returning({ id: answer.id });
  if (updated.length === 0) throw new AskError('That answer isn’t in this business.');
}

/** "Add to dashboard": the answer's question becomes a tile at the top. Returns the tile id (for Undo). */
export async function pinAnswer(member: MemberWorkspace, answerId: string): Promise<string> {
  const ws = member.workspace;
  const [row] = await getAppDb()
    .select()
    .from(answer)
    .where(and(eq(answer.id, answerId), eq(answer.workspaceId, ws.id)));
  const i = row ? interpretationSchema.safeParse(row.interpretation) : undefined;
  if (!row || !i?.success || i.data.kind !== 'query')
    throw new AskError('Only answers with a chart or a number can go on the dashboard.');
  const content = row.content as AnswerContent;
  const tileId = crypto.randomUUID();
  await applyDashboardEdit(
    member,
    row.userId,
    [
      {
        op: 'add_tile',
        title: content.title.split(' · ')[0]!.slice(0, 80),
        spec: i.data.spec,
        chart: content.chart ?? 'table',
        position: 'top',
        fixedDates: content.fixedDates ?? false,
        sourceAnswerId: row.id,
      },
    ],
    { newId: () => tileId },
  );
  return tileId;
}

/** Undo for "Add to dashboard": takes the pinned tile off again. */
export async function unpinTile(member: MemberWorkspace, tileId: string): Promise<void> {
  const { tiles } = await currentDashboard(member);
  if (tiles.some((t) => t.id === tileId))
    await applyDashboardEdit(member, null, [{ op: 'remove_tile', tileId }]);
}

/** Suggestion chips: the pack's examples whose measures this workspace can work out. */
export function suggestedQuestions(
  member: MemberWorkspace,
  available: ReadonlySet<string>,
  limit = 6,
): PackQuestion[] {
  const pack = getPack(member.workspace.packId);
  const ok = pack.questions.filter((q) => q.needs.every((id) => available.has(id)));
  // One from each group first, then the rest.
  const firsts = ok.filter((q, i) => ok.findIndex((x) => x.group === q.group) === i);
  const rest = ok.filter((q) => !firsts.includes(q));
  return [...firsts, ...rest].slice(0, limit);
}
