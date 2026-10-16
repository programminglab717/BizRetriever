import { z } from 'zod';

/**
 * Metric IR (VERTICAL_PACKS §1.6, ARCHITECTURE §7). Metrics are written in this small typed language,
 * never as SQL; the compiler in `@bizr/core/semantic` turns them into SQL for each workspace's real
 * tables. Field references are `entity.field`.
 */

const fieldRef = z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, 'entity.field');
const entityKey = z.string().regex(/^[a-z][a-z0-9_]*$/);
const metricId = z.string().regex(/^[a-z][a-z0-9_]*$/);
export type FieldRef = z.infer<typeof fieldRef>;

// --- Row-level expressions (evaluated per record of an aggregate's base record type) -------------

export type RowExpr =
  | { field: string }
  | { const: number }
  | { add: RowExpr[] }
  | { sub: RowExpr[] }
  | { mul: RowExpr[] }
  | { div: RowExpr[] }
  | { coalesce: RowExpr[] }
  /** A named expression from the pack's `expressions`. */
  | { expr: string }
  /**
   * Shares a parent record's amount across its child records in proportion to `by`, e.g. an order's
   * discount spread over its items by line total. `within` is the child's link to the parent.
   */
  | { allocate: { amount: string; by: RowExpr; within: string } };

export const rowExprSchema: z.ZodType<RowExpr> = z.lazy(() =>
  z.union([
    z.object({ field: fieldRef }).strict(),
    z.object({ const: z.number() }).strict(),
    z.object({ add: z.array(rowExprSchema).min(2) }).strict(),
    z.object({ sub: z.array(rowExprSchema).min(2) }).strict(),
    z.object({ mul: z.array(rowExprSchema).min(2) }).strict(),
    z.object({ div: z.array(rowExprSchema).length(2) }).strict(),
    z.object({ coalesce: z.array(rowExprSchema).min(2) }).strict(),
    z.object({ expr: z.string() }).strict(),
    z
      .object({
        allocate: z.object({ amount: fieldRef, by: rowExprSchema, within: fieldRef }).strict(),
      })
      .strict(),
  ]),
);

export const condOps = [
  'eq',
  'neq',
  'in',
  'not_in',
  'gt',
  'gte',
  'lt',
  'lte',
  'is_null',
  'not_null',
] as const;
export type CondOp = (typeof condOps)[number];

const literal = z.union([z.string(), z.number(), z.boolean()]);
/** The first day of the period or the first day after it, optionally shifted by whole days. */
const periodBound = z
  .object({
    period: z.enum(['start', 'end']),
    offset_days: z.number().int().min(-3660).max(3660).optional(),
  })
  .strict();

/** A row filter. `not_in` and `neq` keep blank values (unknown status counts as completed). */
export const condSchema = z.union([
  /** A named filter from the pack's `filters`. */
  z.string(),
  z
    .object({
      field: fieldRef,
      op: z.enum(condOps),
      value: z.union([literal, z.array(literal).min(1), periodBound]).optional(),
    })
    .strict(),
]);
export type Cond = z.infer<typeof condSchema>;

/**
 * Which records an aggregate looks at, relative to the query's period:
 * - `period` (default): records dated inside it
 * - `to_end`: everything up to the end of the period ("ever, as of then")
 * - `all`: everything, whatever the period
 * - `{ last_days: N }`: the N days before the end of the period
 */
export const windowSchema = z.union([
  z.enum(['period', 'to_end', 'all']),
  z.object({ last_days: z.number().int().min(1).max(3660) }).strict(),
]);
export type Window = z.infer<typeof windowSchema>;

const aggOptions = {
  where: z.array(condSchema).optional(),
  window: windowSchema.optional(),
  /** The record type to aggregate over, when it can't be inferred from the fields. */
  from: entityKey.optional(),
  /** Date that places a record in time, when not the base record type's default. */
  time: fieldRef.optional(),
};

export type Agg =
  | ({ sum: RowExpr } & AggOptions)
  | ({ avg: RowExpr } & AggOptions)
  | ({ min: RowExpr } & AggOptions)
  | ({ max: RowExpr } & AggOptions)
  | ({ count_distinct: RowExpr } & AggOptions)
  | ({ count: true } & AggOptions)
  /** Sum of the most recent value per `per` (e.g. latest stock count per product). */
  | ({ latest: RowExpr; per: string; by: string } & AggOptions);

export interface AggOptions {
  where?: Cond[] | undefined;
  window?: Window | undefined;
  from?: string | undefined;
  time?: string | undefined;
}

export const aggSchema: z.ZodType<Agg> = z.lazy(() =>
  z.union([
    z.object({ sum: rowExprSchema, ...aggOptions }).strict(),
    z.object({ avg: rowExprSchema, ...aggOptions }).strict(),
    z.object({ min: rowExprSchema, ...aggOptions }).strict(),
    z.object({ max: rowExprSchema, ...aggOptions }).strict(),
    z.object({ count_distinct: rowExprSchema, ...aggOptions }).strict(),
    z.object({ count: z.literal(true), ...aggOptions }).strict(),
    z.object({ latest: rowExprSchema, per: fieldRef, by: fieldRef, ...aggOptions }).strict(),
  ]),
);

// --- Metric-level expressions ------------------------------------------------------------------

export type MetricExpr =
  | Agg
  | { ref: string }
  | { const: number }
  | { add: MetricExpr[] }
  | { sub: MetricExpr[] }
  | { mul: MetricExpr[] }
  | { div: MetricExpr[] }
  | { coalesce: MetricExpr[] }
  /** Days from the first date to the second (both from date aggregates or period bounds). */
  | { days_between: MetricExpr[] }
  | { period: 'start' | 'end'; offset_days?: number | undefined }
  /**
   * Computes `measure` (or nothing, for `rollup: count`) once per record of `per` (e.g. per
   * customer), keeps those that meet every condition, then sums / counts / averages them.
   */
  | { per: string; rollup: 'sum' | 'count' | 'avg'; measure?: MetricExpr; where?: MetricCond[] };

export interface MetricCond {
  of: MetricExpr;
  op: Exclude<CondOp, 'in' | 'not_in'>;
  value?: number | MetricExpr;
}

export const metricExprSchema: z.ZodType<MetricExpr> = z.lazy(() =>
  z.union([
    aggSchema,
    z.object({ ref: metricId }).strict(),
    z.object({ const: z.number() }).strict(),
    z.object({ add: z.array(metricExprSchema).min(2) }).strict(),
    z.object({ sub: z.array(metricExprSchema).min(2) }).strict(),
    z.object({ mul: z.array(metricExprSchema).min(2) }).strict(),
    z.object({ div: z.array(metricExprSchema).length(2) }).strict(),
    z.object({ coalesce: z.array(metricExprSchema).min(2) }).strict(),
    z.object({ days_between: z.array(metricExprSchema).length(2) }).strict(),
    periodBound,
    z
      .object({
        per: entityKey,
        rollup: z.enum(['sum', 'count', 'avg']),
        measure: metricExprSchema.optional(),
        where: z.array(metricCondSchema).optional(),
      })
      .strict(),
  ]),
);

export const metricCondSchema: z.ZodType<MetricCond> = z.lazy(() =>
  z
    .object({
      of: metricExprSchema,
      op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'not_null']),
      value: z.union([z.number(), metricExprSchema]).optional(),
    })
    .strict(),
);

// --- Pack file ---------------------------------------------------------------------------------

export const metricFormats = ['money', 'number', 'percent', 'days'] as const;
export type MetricFormat = (typeof metricFormats)[number];

export const packMetricSchema = z
  .object({
    id: metricId,
    label: z.string().min(1),
    /** Plain language; shown in "How I calculated this". */
    description: z.string().min(1),
    format: z.enum(metricFormats),
    good_direction: z.enum(['up', 'down', 'neutral']).default('up'),
    ir: metricExprSchema,
    /** At least one of these details must have data (for "either/or" metrics like discounts). */
    requires_any: z.array(fieldRef).optional(),
    /** Plain-language call to action when the metric can't be shown yet. */
    unavailable_hint: z.string().optional(),
    /** Time range used when a question doesn't name one (default: all time). */
    default_time: z
      .enum([
        'this_month',
        'last_month',
        'this_quarter',
        'this_year',
        'last_30_days',
        'last_90_days',
      ])
      .optional(),
    /** Words owners use for this measure ("takings", "revenue"), for question answering. */
    synonyms: z.array(z.string().min(1)).default([]),
    /** Stated to the owner whenever the metric is used. */
    assumptions: z.array(z.string()).default([]),
    /** Shown as a snapshot ("as of your latest count") rather than over a period. */
    snapshot: z.boolean().default(false),
  })
  .strict();
export type PackMetric = z.infer<typeof packMetricSchema>;

export const packDimensionSchema = z
  .object({
    field: fieldRef,
    label: z.string().min(1),
    synonyms: z.array(z.string()).default([]),
    /** How answers count it: ["product", "products"]. */
    noun: z.tuple([z.string().min(1), z.string().min(1)]).optional(),
    /** Display names for coded values: { online_store: Website }. */
    value_labels: z.record(z.string(), z.string().min(1)).default({}),
  })
  .strict();
export type PackDimension = z.infer<typeof packDimensionSchema>;

export const joinPathSchema = z
  .object({ from: entityKey, to: entityKey, via: z.array(fieldRef).min(1) })
  .strict();
export type JoinPath = z.infer<typeof joinPathSchema>;

export const packMetricsFileSchema = z
  .object({
    expressions: z.record(z.string(), rowExprSchema).default({}),
    filters: z.record(z.string(), z.array(condSchema)).default({}),
    dimensions: z.array(packDimensionSchema).default([]),
    /** Preferred link paths where two routes exist between record types. */
    join_paths: z.array(joinPathSchema).default([]),
    metrics: z.array(packMetricSchema).min(1),
  })
  .strict();
export type PackMetrics = z.infer<typeof packMetricsFileSchema>;

// --- Cross-checks ------------------------------------------------------------------------------

interface EntityLike {
  id: string;
  fields: { id: string; type: string; references?: string | undefined }[];
}

/** Every field, entity, metric, expression and filter a metrics file mentions must exist. */
export function checkMetrics(entities: readonly EntityLike[], file: PackMetrics): string[] {
  const problems: string[] = [];
  const hasEntity = (e: string) => entities.some((x) => x.id === e);
  const field = (ref: string) => {
    const [e, f] = ref.split('.');
    return entities.find((x) => x.id === e)?.fields.find((x) => x.id === f);
  };
  const checkField = (where: string, ref: string) => {
    if (!field(ref)) problems.push(`${where}: unknown field "${ref}"`);
  };
  const ids = new Set<string>();
  for (const m of file.metrics) {
    if (ids.has(m.id)) problems.push(`metric "${m.id}" is defined twice`);
    ids.add(m.id);
  }

  const visitRow = (where: string, e: RowExpr) => {
    if ('field' in e) checkField(where, e.field);
    else if ('expr' in e) {
      if (!(e.expr in file.expressions)) problems.push(`${where}: unknown expression "${e.expr}"`);
    } else if ('allocate' in e) {
      checkField(where, e.allocate.amount);
      checkField(where, e.allocate.within);
      if (field(e.allocate.within)?.type !== 'reference')
        problems.push(`${where}: "${e.allocate.within}" must be a link`);
      visitRow(where, e.allocate.by);
    } else if (!('const' in e)) {
      for (const arg of Object.values<RowExpr[]>(e as Record<string, RowExpr[]>))
        arg.forEach((a) => visitRow(where, a));
    }
  };
  const visitCond = (where: string, c: Cond) => {
    if (typeof c === 'string') {
      if (!(c in file.filters)) problems.push(`${where}: unknown filter "${c}"`);
    } else checkField(where, c.field);
  };
  const visitMetric = (where: string, e: MetricExpr) => {
    if ('ref' in e) {
      if (!ids.has(e.ref)) problems.push(`${where}: unknown metric "${e.ref}"`);
      return;
    }
    if ('const' in e || 'period' in e) return;
    if ('per' in e && 'rollup' in e) {
      if (!hasEntity(e.per)) problems.push(`${where}: unknown record type "${e.per}"`);
      if (e.measure) visitMetric(where, e.measure);
      for (const c of e.where ?? []) {
        visitMetric(where, c.of);
        if (typeof c.value === 'object') visitMetric(where, c.value);
      }
      if (e.rollup !== 'count' && !e.measure)
        problems.push(`${where}: rollup ${e.rollup} needs a measure`);
      return;
    }
    for (const k of ['add', 'sub', 'mul', 'div', 'coalesce', 'days_between'] as const) {
      if (k in e) {
        (e as Record<string, MetricExpr[]>)[k]!.forEach((a) => visitMetric(where, a));
        return;
      }
    }
    // An aggregate.
    const agg = e as Agg & Record<string, unknown>;
    for (const k of ['sum', 'avg', 'min', 'max', 'count_distinct', 'latest'] as const) {
      if (k in agg) visitRow(where, agg[k] as RowExpr);
    }
    if ('latest' in agg && typeof agg.per === 'string' && typeof agg.by === 'string') {
      checkField(where, agg.per);
      checkField(where, agg.by);
    }
    if (agg.from && !hasEntity(agg.from))
      problems.push(`${where}: unknown record type "${agg.from}"`);
    if (agg.time) checkField(where, agg.time);
    for (const c of agg.where ?? []) visitCond(where, c);
  };

  for (const [name, e] of Object.entries(file.expressions)) visitRow(`expression ${name}`, e);
  for (const [name, conds] of Object.entries(file.filters))
    conds.forEach((c) => visitCond(`filter ${name}`, c));
  for (const d of file.dimensions) {
    const f = field(d.field);
    if (!f) problems.push(`dimension: unknown field "${d.field}"`);
    else if (f.type === 'reference') problems.push(`dimension "${d.field}" must not be a link`);
  }
  for (const p of file.join_paths)
    p.via.forEach((v) => checkField(`join path ${p.from}→${p.to}`, v));
  for (const m of file.metrics) {
    visitMetric(`metric ${m.id}`, m.ir);
    for (const r of m.requires_any ?? []) checkField(`metric ${m.id}`, r);
  }

  // No metric may depend on itself.
  const deps = new Map<string, string[]>();
  const refsIn = (e: unknown, out: string[]) => {
    if (!e || typeof e !== 'object') return;
    if ('ref' in e && typeof e.ref === 'string') out.push((e as { ref: string }).ref);
    for (const v of Object.values(e)) {
      if (Array.isArray(v)) v.forEach((x) => refsIn(x, out));
      else if (typeof v === 'object') refsIn(v, out);
    }
  };
  for (const m of file.metrics) {
    const out: string[] = [];
    refsIn(m.ir, out);
    deps.set(m.id, out);
  }
  const visiting = new Set<string>();
  const done = new Set<string>();
  const cycle = (id: string): boolean => {
    if (done.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    const found = (deps.get(id) ?? []).some(cycle);
    visiting.delete(id);
    done.add(id);
    return found;
  };
  for (const m of file.metrics)
    if (cycle(m.id)) problems.push(`metric "${m.id}" depends on itself`);
  return problems;
}
