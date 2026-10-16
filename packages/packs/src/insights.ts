import { z } from 'zod';

import type { PackMetrics } from './metrics';

/**
 * The pack's insight rules (VERTICAL_PACKS §2.7). Each rule runs one or more questions (query specs
 * with dates relative to today), then decides by small, typed expressions over the results: which
 * rows deserve an insight, how serious it is, and the facts its sentence is filled with. Numbers
 * only ever come from the query results (and arithmetic on them); the sentence is a trusted
 * template with placeholders. The engine that runs these is industry-agnostic (`@bizr/core/insights`).
 */

const id = z.string().regex(/^[a-z][a-z0-9_]*$/);
const fieldRef = z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, 'entity.field');
/** `query.metric`, `query.dN` (a breakdown), or `key` (the row's first breakdown). */
const ref = z
  .string()
  .regex(/^(key|[a-z][a-z0-9_]*\.(d[0-9]|[a-z][a-z0-9_]*))$/, 'query.metric, query.dN or key');

export type InsightExpr =
  | number
  | string
  | { threshold: string }
  /** A fact already worked out for this insight (summary rules' totals, for instance). */
  | { fact: string }
  | { add: InsightExpr[] }
  | { sub: InsightExpr[] }
  | { mul: InsightExpr[] }
  | { div: InsightExpr[] }
  | { min: InsightExpr[] }
  | { max: InsightExpr[] }
  | { abs: InsightExpr }
  /** The first value that isn't blank. */
  | { coalesce: InsightExpr[] }
  /** new ÷ old − 1. */
  | { pct_change: InsightExpr[] }
  /** This row's value ÷ the total over all rows of its question. */
  | { share: string }
  /** The total over all rows of a question (ignoring blank keys). */
  | { total: string }
  /** Several rows per key (broken down by a date as `d1`): the value on the latest one… */
  | { last: string }
  /** …and the most recent value before it changed to that. */
  | { prior: string };

export const insightExprSchema: z.ZodType<InsightExpr> = z.lazy(() =>
  z.union([
    z.number(),
    ref,
    z.object({ threshold: id }).strict(),
    z.object({ fact: id }).strict(),
    z.object({ add: z.array(insightExprSchema).min(2) }).strict(),
    z.object({ sub: z.array(insightExprSchema).length(2) }).strict(),
    z.object({ mul: z.array(insightExprSchema).min(2) }).strict(),
    z.object({ div: z.array(insightExprSchema).length(2) }).strict(),
    z.object({ min: z.array(insightExprSchema).min(2) }).strict(),
    z.object({ max: z.array(insightExprSchema).min(2) }).strict(),
    z.object({ abs: insightExprSchema }).strict(),
    z.object({ coalesce: z.array(insightExprSchema).min(2) }).strict(),
    z.object({ pct_change: z.array(insightExprSchema).length(2) }).strict(),
    z.object({ share: ref }).strict(),
    z.object({ total: ref }).strict(),
    z.object({ last: ref }).strict(),
    z.object({ prior: ref }).strict(),
  ]),
);

export type InsightCond =
  | { lt: InsightExpr[] }
  | { lte: InsightExpr[] }
  | { gt: InsightExpr[] }
  | { gte: InsightExpr[] }
  | { eq: InsightExpr[] }
  | { neq: InsightExpr[] }
  | { all: InsightCond[] }
  | { any: InsightCond[] }
  | { present: string };

export const insightCondSchema: z.ZodType<InsightCond> = z.lazy(() =>
  z.union([
    ...(['lt', 'lte', 'gt', 'gte', 'eq', 'neq'] as const).map((op) =>
      z.object({ [op]: z.array(insightExprSchema).length(2) }).strict(),
    ),
    z.object({ all: z.array(insightCondSchema).min(1) }).strict(),
    z.object({ any: z.array(insightCondSchema).min(1) }).strict(),
    z.object({ present: ref }).strict(),
  ] as unknown as [z.ZodType<InsightCond>, z.ZodType<InsightCond>, ...z.ZodType<InsightCond>[]]),
);

/** Dates relative to today: `to` is exclusive, today isn't included (its sales aren't in yet). */
export const insightPeriodSchema = z.union([
  z.object({ last_days: z.number().int().min(1).max(3660) }).strict(),
  /** From N days ago up to M days ago. */
  z.object({ days_ago: z.tuple([z.number().int().min(1), z.number().int().min(0)]) }).strict(),
  /** Everything up to today (for snapshot measures like stock). */
  z.object({ to_date: z.literal(true) }).strict(),
]);
export type InsightPeriod = z.infer<typeof insightPeriodSchema>;

export const insightQuerySchema = z
  .object({
    metrics: z.array(id).min(1).max(6),
    /** The first breakdown is the row's key (the product, the customer…). */
    dimensions: z
      .array(
        z.union([
          z.object({ field: fieldRef }).strict(),
          z.object({ time: z.enum(['day', 'week', 'month']) }).strict(),
        ]),
      )
      .max(3)
      .default([]),
    filters: z
      .array(
        z
          .object({
            field: fieldRef,
            op: z.enum(['eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'contains']),
            value: z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.array(z.union([z.string(), z.number(), z.boolean()])).min(1),
            ]),
          })
          .strict(),
      )
      .default([]),
    period: insightPeriodSchema,
    compare: z.literal('previous_period').optional(),
    having: z
      .array(
        z
          .object({
            metric: id,
            op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']),
            value: z.number(),
          })
          .strict(),
      )
      .default([]),
    sort: z
      .object({ by: id, dir: z.enum(['asc', 'desc']).default('desc') })
      .strict()
      .optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .strict();
export type InsightQuery = z.infer<typeof insightQuerySchema>;

export const factFormats = [
  'money',
  'number',
  'integer',
  'percent',
  'points',
  'days',
  'text',
] as const;
export type FactFormat = (typeof factFormats)[number];

export const insightFactSchema = z.union([
  z.object({ value: insightExprSchema, format: z.enum(factFormats).exclude(['text']) }).strict(),
  /**
   * A name from the results: `key`, or a breakdown like `q.d1`. With several rows per key, the one
   * with the largest `by` (the top reason). `fallback` when it's blank.
   */
  z.object({ text: ref, by: ref.optional(), fallback: z.string().max(60).optional() }).strict(),
  /** A word chosen by a condition ("up" or "down"). */
  z
    .object({ choose: insightCondSchema, then: z.string().max(40), else: z.string().max(40) })
    .strict(),
  /** Summary rules: how many rows qualified… */
  z.object({ count: z.literal(true) }).strict(),
  /** …their total… */
  z.object({ sum: insightExprSchema, format: z.enum(factFormats).exclude(['text']) }).strict(),
  /** …and the value (or name) of the row with the largest `by`. */
  z
    .object({
      top: z.union([ref, insightExprSchema]),
      by: insightExprSchema,
      format: z.enum(factFormats).default('text'),
    })
    .strict(),
]);
export type InsightFact = z.infer<typeof insightFactSchema>;

export const insightCategories = [
  'stock',
  'customers',
  'profit',
  'products',
  'trends',
  'cash',
] as const;
export type InsightCategory = (typeof insightCategories)[number];

export const packInsightRuleSchema = z
  .object({
    id,
    category: z.enum(insightCategories),
    /** Name in alert settings ("Running out of stock"). */
    label: z.string().min(1).max(60),
    description: z.string().min(1).max(200),
    enabled: z.boolean().default(true),
    /** Owner-adjustable numbers, phrased for the settings page ("Warn me when … within {{value}} days"). */
    thresholds: z
      .record(
        id,
        z
          .object({
            label: z.string().min(1).max(120),
            default: z.number(),
            min: z.number(),
            max: z.number(),
            /** Percent thresholds are stored as fractions (0.1) and shown as 10. */
            unit: z.enum(['days', 'percent', 'money', 'count', 'points']),
            editable: z.boolean().default(true),
          })
          .strict(),
      )
      .default({}),
    /** Needs this many days of sales history (trend rules): skipped, and said so, until then. */
    needs_history_days: z.number().int().min(0).max(730).default(0),
    queries: z
      .record(id, insightQuerySchema)
      .refine((q) => Object.keys(q).length >= 1, 'at least one question'),
    /** `each`: one insight per qualifying row (product, customer…). `summary`: one insight for all of them. */
    scope: z.enum(['each', 'summary']),
    /** The question whose rows are considered (default: the first). Others are looked up by key. */
    rows: id.optional(),
    where: insightCondSchema.optional(),
    /** Summary rules: only when this holds over the qualifying rows (facts are in scope). */
    require: insightCondSchema.optional(),
    facts: z.record(id, insightFactSchema),
    severity: z
      .object({
        urgent: insightCondSchema.optional(),
        warn: insightCondSchema.optional(),
        /** When neither condition holds. */
        otherwise: z.enum(['warn', 'info']).default('info'),
        /** Money at stake, for ordering. */
        impact: insightExprSchema.optional(),
      })
      .strict(),
    /** Plain-language sentence; `{{fact}}` placeholders are filled by code; `**…**` is bold. */
    template: z.string().min(10).max(400),
    /** One line of context under the headline. */
    context: z.string().max(200).optional(),
    action: z
      .union([
        z.object({ label: z.string().min(1).max(40), ask: z.string().min(5).max(200) }).strict(),
        z
          .object({ label: z.string().min(1).max(40), records: id, search: ref.optional() })
          .strict(),
      ])
      .optional(),
    /** Each-scope rules: at most this many insights, the biggest first. */
    limit: z.number().int().min(1).max(20).default(3),
    /** A dismissed or resolved insight doesn't come back as new for this long. */
    cooldown_days: z.number().int().min(0).max(365).default(14),
  })
  .strict();
export type PackInsightRule = z.infer<typeof packInsightRuleSchema>;

export const packInsightsFileSchema = z
  .object({ rules: z.array(packInsightRuleSchema).min(1) })
  .strict();
export type PackInsights = z.infer<typeof packInsightsFileSchema>;

// --- Checks across files -------------------------------------------------------------------------

function refsOf(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) x.forEach((v) => refsOf(v, out));
  else if (x && typeof x === 'object')
    for (const [k, v] of Object.entries(x)) {
      if (k === 'threshold' || k === 'fact') continue;
      refsOf(v, out);
    }
  return out;
}

function namesOf(kind: 'threshold' | 'fact', x: unknown, out: string[] = []): string[] {
  if (Array.isArray(x)) x.forEach((v) => namesOf(kind, v, out));
  else if (x && typeof x === 'object')
    for (const [k, v] of Object.entries(x)) {
      if (k === kind && typeof v === 'string') out.push(v);
      else namesOf(kind, v, out);
    }
  return out;
}

export function checkInsights(metrics: PackMetrics, insights: PackInsights): string[] {
  const problems: string[] = [];
  const metricIds = new Set(metrics.metrics.map((m) => m.id));
  const seen = new Set<string>();
  for (const r of insights.rules) {
    const where = `rule "${r.id}"`;
    if (seen.has(r.id)) problems.push(`${where} is listed twice`);
    seen.add(r.id);
    const queries = Object.entries(r.queries);
    for (const [name, q] of queries) {
      for (const m of [...q.metrics, ...q.having.map((h) => h.metric)])
        if (!metricIds.has(m))
          problems.push(`${where} question "${name}" uses unknown measure "${m}"`);
      if (q.sort && !q.metrics.includes(q.sort.by))
        problems.push(`${where} question "${name}" sorts by "${q.sort.by}" without asking for it`);
    }
    if (r.rows && !r.queries[r.rows])
      problems.push(`${where} takes rows from unknown question "${r.rows}"`);
    // Every reference names a question and something it returns.
    const check = (x: unknown, what: string) => {
      for (const s of refsOf(x)) {
        if (s === 'key' || !s.includes('.')) continue;
        const [qn, part] = s.split('.') as [string, string];
        const q = r.queries[qn];
        if (!q) {
          problems.push(`${where} ${what} refers to unknown question "${qn}"`);
          continue;
        }
        if (/^d\d$/.test(part)) {
          if (Number(part.slice(1)) >= q.dimensions.length)
            problems.push(`${where} ${what} uses "${s}", a breakdown "${qn}" doesn't have`);
        } else if (!q.metrics.includes(part.replace(/__prev$/, '')))
          problems.push(`${where} ${what} uses "${s}", which "${qn}" doesn't ask for`);
        else if (part.endsWith('__prev') && !q.compare)
          problems.push(`${where} ${what} uses "${s}" but "${qn}" has no comparison`);
      }
      for (const t of namesOf('threshold', x))
        if (!r.thresholds[t]) problems.push(`${where} ${what} uses unknown threshold "${t}"`);
      for (const f of namesOf('fact', x))
        if (!r.facts[f]) problems.push(`${where} ${what} uses unknown fact "${f}"`);
    };
    check(r.where, 'condition');
    if (namesOf('fact', r.where).length)
      problems.push(`${where} condition can't use facts (they're worked out after it)`);
    check(r.require, 'requirement');
    check(r.severity, 'severity');
    check(r.action, 'action');
    for (const [name, f] of Object.entries(r.facts)) {
      check(f, `fact "${name}"`);
      if (r.scope === 'each' && ('count' in f || 'sum' in f || 'top' in f))
        problems.push(`${where} fact "${name}" summarises rows, which only summary rules can do`);
    }
    for (const p of r.template.matchAll(/\{\{\s*([a-z_][a-z0-9_]*)\s*(?:\|[^}]*)?\}\}/g))
      if (!r.facts[p[1]!]) problems.push(`${where} template uses unknown fact "${p[1]}"`);
    for (const p of (r.context ?? '').matchAll(/\{\{\s*([a-z_][a-z0-9_]*)\s*(?:\|[^}]*)?\}\}/g))
      if (!r.facts[p[1]!]) problems.push(`${where} context uses unknown fact "${p[1]}"`);
    if (r.action && 'ask' in r.action)
      for (const p of r.action.ask.matchAll(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/g))
        if (!r.facts[p[1]!]) problems.push(`${where} action uses unknown fact "${p[1]}"`);
    for (const [what, text] of [
      ['template', r.template],
      ['context', r.context ?? ''],
    ] as const)
      if (/\d/.test(text.replace(/\{\{[^}]*\}\}/g, '')))
        problems.push(`${where} ${what} has a number outside a placeholder`);
    for (const [name, t] of Object.entries(r.thresholds)) {
      if (t.default < t.min || t.default > t.max)
        problems.push(`${where} threshold "${name}" default is outside its range`);
      if (t.editable && !t.label.includes('{{value}}'))
        problems.push(`${where} threshold "${name}" label needs {{value}}`);
    }
  }
  return problems;
}
