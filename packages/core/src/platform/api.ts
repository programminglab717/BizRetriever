import { getPack } from '@bizr/packs';
import { getEnv } from '@bizr/platform';
import { z } from 'zod';

import { toAnswerData, type AnswerData } from '../ask/answer';
import { loadAskContext } from '../ask/catalog';
import { periodOf, questionSpecSchema, titleFor, toQuerySpec } from '../ask/interpretation';
import { askQuestion, type AskOptions } from '../ask/service';
import { periodLabel, timePresets } from '../ask/time';
import { localeFor, tableView, type ViewOptions } from '../ask/view';
import { dashboardRangeSchema } from '../dashboard/model';
import { dashboardView } from '../dashboard/service';
import { getInsights } from '../insights/feed';
import { SemanticError } from '../semantic/graph';
import { compileContext, runQuery } from '../semantic/service';
import { timeGrains } from '../semantic/query-spec';
import type { MemberWorkspace } from '../workspaces/service';

/**
 * The read-only public API (M16, ADR-066), shared by `/api/v1` and the MCP server. Every number
 * comes from a query compiled by our code from a typed spec and executed as the business's reader
 * (safety rules 1 and 5); nothing here writes. Values are the business's own data: callers that
 * pass them to an AI must treat them as data, not instructions.
 */

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 404 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const dayBefore = (iso: string) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

const words = (segments: readonly { text: string }[] | null | undefined) =>
  segments
    ?.map((s) => s.text)
    .join('')
    .trim() ?? '';

function viewOptions(member: MemberWorkspace): ViewOptions {
  return {
    pack: getPack(member.workspace.packId),
    locale: localeFor(member.settings),
    currency: member.settings.currency,
    fiscalYearStartMonth: member.settings.fiscalYearStartMonth,
  };
}

// --- The business --------------------------------------------------------------------------------

export interface BusinessInfo {
  name: string;
  industry: string;
  currency: string;
  timezone: string;
  /** Today in the business's time zone: what "this month" and "last week" are counted from. */
  today: string;
  link: string;
}

export function businessInfo(member: MemberWorkspace, now = new Date()): BusinessInfo {
  const ws = member.workspace;
  return {
    name: ws.name,
    industry: getPack(ws.packId).manifest.name,
    currency: member.settings.currency,
    timezone: member.settings.timezone,
    today: compileContext(member, now).today,
    link: `${getEnv().APP_URL}/w/${ws.slug}/home`,
  };
}

// --- What can be asked ---------------------------------------------------------------------------

export interface MeasureList {
  measures: {
    key: string;
    label: string;
    description: string;
    format: string;
    available: boolean;
    reason?: string;
  }[];
  /** What numbers can be broken down or filtered by, as `record.detail`. */
  details: { key: string; label: string; examples: string[] }[];
  timeGrains: readonly string[];
  periods: readonly string[];
}

export async function listMeasures(member: MemberWorkspace): Promise<MeasureList> {
  const { catalog } = await loadAskContext(member);
  return {
    measures: catalog.metrics.map((m) => ({
      key: m.id,
      label: m.label,
      description: m.description,
      format: m.format,
      available: m.available,
      ...(m.reason ? { reason: m.reason } : {}),
    })),
    details: catalog.dimensions.map((d) => ({
      key: d.field,
      label: d.label,
      examples: d.values.slice(0, 10).map((v) => d.valueLabels[v] ?? v),
    })),
    timeGrains,
    periods: timePresets,
  };
}

// --- A query in the typed form -------------------------------------------------------------------

/**
 * The same typed form Ask's interpreter produces (AI_DESIGN Task D), with friendlier defaults:
 * no breakdown, no filters, all time.
 */
export const apiQuerySchema = z
  .object({
    metrics: questionSpecSchema.shape.metrics,
    dimensions: questionSpecSchema.shape.dimensions.default([]),
    filters: questionSpecSchema.shape.filters.default([]),
    having: questionSpecSchema.shape.having.default([]),
    timeRange: questionSpecSchema.shape.timeRange.default({ preset: 'all_time' }),
    compareTo: questionSpecSchema.shape.compareTo,
    orderBy: questionSpecSchema.shape.orderBy,
    limit: questionSpecSchema.shape.limit,
  })
  .strict();
export type ApiQuery = z.input<typeof apiQuerySchema>;

export interface ApiTable {
  columns: { key: string; label: string; kind: string; format?: string }[];
  /** Values as the query returned them: money and decimals as exact strings. */
  rows: Record<string, string | number | null>[];
  /** The same values formatted as the app shows them. */
  text: Record<string, string>[];
  totalRows: number;
  truncated: boolean;
}

export interface ApiQueryResult extends ApiTable {
  title: string;
  /** `to` is the last day included. */
  period: { from: string; to: string; label: string } | null;
  assumptions: string[];
}

function apiTable(data: AnswerData, o: ViewOptions): ApiTable {
  const view = tableView(data, o);
  const keys = view.columns.map((c) => c.key);
  return {
    columns: data.columns.map((c) => ({
      key: c.key,
      label: c.label,
      kind: c.kind,
      ...(c.format ? { format: c.format } : {}),
    })),
    rows: data.rows,
    text: view.rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, r.cells[i]?.text ?? '']))),
    totalRows: data.totalRows,
    truncated: data.truncated,
  };
}

export async function runApiQuery(
  member: MemberWorkspace,
  input: unknown,
  now = new Date(),
): Promise<ApiQueryResult> {
  const parsed = apiQuerySchema.safeParse(input);
  if (!parsed.success)
    throw new ApiError(400, 'invalid_query', z.prettifyError(parsed.error).slice(0, 1000));
  const spec = parsed.data;
  const ctx = await loadAskContext(member);
  const cc = compileContext(member, now);
  const cal = {
    today: cc.today,
    weekStart: cc.weekStart,
    fiscalYearStartMonth: cc.fiscalYearStartMonth,
  };
  const unknown = spec.metrics.filter((id) => !ctx.catalog.metrics.some((m) => m.id === id));
  if (unknown.length)
    throw new ApiError(422, 'unknown_measure', `No measure called ${unknown.join(', ')}.`);
  let result;
  try {
    result = await runQuery(member, toQuerySpec(spec, cal), 'api', ctx.model);
  } catch (err) {
    if (err instanceof SemanticError) throw new ApiError(422, 'cannot_answer', err.message);
    throw err;
  }
  const period = periodOf(spec.timeRange, cal);
  const labels = {
    metric: (id: string) => ctx.catalog.metrics.find((m) => m.id === id)?.label ?? id,
    dimension: (ref: string) => ctx.catalog.dimensions.find((d) => d.field === ref)?.label ?? ref,
  };
  return {
    title: titleFor(spec, cal, labels),
    // Our periods end the day after; callers get the last day included.
    period: period
      ? { from: period.from, to: dayBefore(period.to), label: periodLabel(period) }
      : null,
    assumptions: result.assumptions,
    ...apiTable(toAnswerData(result), viewOptions(member)),
  };
}

// --- A question in plain words -------------------------------------------------------------------

export interface ApiAnswer {
  id: string;
  kind: string;
  title: string;
  /** The answer in a sentence; its numbers were filled in by code from the result. */
  answer: string;
  table?: ApiTable;
  assumptions: string[];
  steps?: string[];
  clarify?: { question: string; options: string[] };
  unanswerable?: { message: string; missing: string[] };
  error?: string;
  link: string;
}

export const apiAskSchema = z.object({ question: z.string().trim().min(1).max(500) }).strict();

export async function askApi(
  member: MemberWorkspace,
  input: unknown,
  options: AskOptions = {},
): Promise<ApiAnswer> {
  const parsed = apiAskSchema.safeParse(input);
  if (!parsed.success)
    throw new ApiError(400, 'invalid_question', 'Send a question (1–500 characters).');
  // Asked by an app, not a person: it doesn't appear in anyone's Ask history.
  const r = await askQuestion(member, null, { question: parsed.data.question }, options);
  const c = r.content;
  return {
    id: r.answerId,
    kind: r.kind,
    title: c.title,
    answer: words(c.headline) || c.clarify?.question || c.unanswerable?.message || c.error || '',
    ...(c.data ? { table: apiTable(c.data, viewOptions(member)) } : {}),
    assumptions: c.assumptions,
    ...(c.steps ? { steps: c.steps } : {}),
    ...(c.clarify ? { clarify: c.clarify } : {}),
    ...(c.unanswerable
      ? { unanswerable: { message: c.unanswerable.message, missing: c.unanswerable.missing } }
      : {}),
    ...(c.error ? { error: c.error } : {}),
    link: `${getEnv().APP_URL}/w/${member.workspace.slug}/ask?${new URLSearchParams({ q: r.question }).toString()}`,
  };
}

// --- Insights ------------------------------------------------------------------------------------

export interface ApiInsight {
  id: string;
  level: string;
  category: string;
  text: string;
  detail: string;
  firstSeenAt: string;
  lastSeenAt: string;
  link: string;
}

export async function listApiInsights(
  member: MemberWorkspace,
  options: { limit?: number } = {},
): Promise<{ insights: ApiInsight[]; checkedAt: string | null }> {
  const o = await getInsights(member, { limit: Math.min(Math.max(options.limit ?? 20, 1), 100) });
  const base = `${getEnv().APP_URL}/w/${member.workspace.slug}/insights`;
  return {
    insights: o.insights.map((i) => ({
      id: i.id,
      level: i.level,
      category: i.category,
      text: words(i.headline) || i.text,
      detail: words(i.context),
      firstSeenAt: i.firstSeenAt.toISOString(),
      lastSeenAt: i.lastSeenAt.toISOString(),
      link: base,
    })),
    checkedAt: o.lastRun?.finishedAt?.toISOString() ?? null,
  };
}

// --- The dashboard -------------------------------------------------------------------------------

export interface ApiDashboard {
  range: string;
  comparedWith?: string;
  tiles: {
    title: string;
    chart: string;
    dates?: string;
    numbers?: { label: string; text: string; change?: string }[];
    table?: { columns: string[]; rows: string[][] };
    error?: string;
  }[];
  link: string;
}

export async function apiDashboard(
  member: MemberWorkspace,
  range?: unknown,
): Promise<ApiDashboard> {
  let r;
  if (range !== undefined) {
    const parsed = dashboardRangeSchema.safeParse(range);
    if (!parsed.success)
      throw new ApiError(400, 'invalid_range', 'That date range isn’t one we know.');
    r = parsed.data;
  }
  const view = await dashboardView(member, r);
  return {
    range: view.rangeLabel,
    ...(view.comparedWith ? { comparedWith: view.comparedWith } : {}),
    tiles: view.tiles.map((t) => ({
      title: t.title,
      chart: t.chart,
      ...(t.datesLabel ? { dates: t.datesLabel } : {}),
      ...(t.kpis?.length
        ? {
            numbers: t.kpis.map((k) => ({
              label: k.label,
              text: k.text,
              ...(k.change ? { change: k.change.text } : {}),
            })),
          }
        : {}),
      ...(t.table && t.table.rows.length > 1
        ? {
            table: {
              columns: t.table.columns.map((c) => c.label),
              rows: t.table.rows.map((row) => row.cells.map((c) => c.text)),
            },
          }
        : {}),
      ...(t.error ? { error: t.error } : {}),
    })),
    link: `${getEnv().APP_URL}/w/${member.workspace.slug}/dashboard`,
  };
}
