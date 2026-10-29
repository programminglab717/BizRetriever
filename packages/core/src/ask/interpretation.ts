import type { Language } from '@bizr/i18n';
import { z } from 'zod';

import type { QuerySpecInput } from '../semantic/query-spec';
import { timeGrains } from '../semantic/query-spec';
import { periodLabel, resolvePreset, timePresets, type Calendar, type Period } from './time';

/**
 * What a question means (AI_DESIGN Task D). Produced by the rule-based interpreter or the AI, in the
 * same typed form. Only code turns it into SQL: a query spec through the compiler, or (rarely)
 * validated fallback SQL. Wire-safe for structured outputs: no recursion, no open-ended maps.
 */

const id = z.string().regex(/^[a-z][a-z0-9_]{0,60}$/);
const fieldRef = z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const timeRangeSchema = z.union([
  z.object({ preset: z.enum(timePresets) }).strict(),
  z.object({ from: isoDate, to: isoDate }).strict(),
]);
export type TimeRange = z.infer<typeof timeRangeSchema>;

export const questionSpecSchema = z
  .object({
    metrics: z.array(id).min(1).max(4),
    dimensions: z
      .array(
        z.union([
          z.object({ field: fieldRef }).strict(),
          z.object({ time: z.enum(timeGrains) }).strict(),
        ]),
      )
      .max(2),
    filters: z
      .array(
        z
          .object({
            field: fieldRef,
            op: z.enum(['eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'contains']),
            values: z
              .array(z.union([z.string().max(200), z.number(), z.boolean()]))
              .min(1)
              .max(50),
          })
          .strict(),
      )
      .max(6),
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
      .max(2),
    timeRange: timeRangeSchema,
    compareTo: z.enum(['previous_period', 'same_period_last_year']).optional(),
    /** A metric id, or `d0` / `d1` for a breakdown. */
    orderBy: z
      .object({ by: id, dir: z.enum(['asc', 'desc']) })
      .strict()
      .optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export type QuestionSpec = z.infer<typeof questionSpecSchema>;

export const chartTypes = ['kpi', 'line', 'bar', 'bar_horizontal', 'stacked_bar', 'table'] as const;
export type ChartType = (typeof chartTypes)[number];

const assumption = z.string().min(1).max(240);

export const interpretationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('query'),
      spec: questionSpecSchema,
      assumptions: z.array(assumption).max(5),
      chart: z.enum(chartTypes).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('clarify'),
      question: z.string().min(1).max(240),
      options: z
        .array(
          z
            .object({
              label: z.string().min(1).max(80),
              spec: questionSpecSchema,
              assumptions: z.array(assumption).max(3),
            })
            .strict(),
        )
        .min(2)
        .max(4),
    })
    .strict(),
  z
    .object({
      kind: z.literal('sql'),
      sql: z.string().min(1).max(8_000),
      rationale: z.string().max(400),
      assumptions: z.array(assumption).max(5),
    })
    .strict(),
  z
    .object({
      kind: z.literal('unanswerable'),
      /** `change_request`: an ask to add or change data, not a question (set by code, M6). */
      reason: z.enum(['missing_data', 'out_of_scope', 'unclear', 'change_request']),
      missing: z.array(z.string().max(80)).max(5),
      message: z.string().min(1).max(300),
    })
    .strict(),
]);
export type Interpretation = z.infer<typeof interpretationSchema>;

export function periodOf(range: TimeRange, cal: Calendar): Period | undefined {
  return 'preset' in range ? resolvePreset(range.preset, cal) : { from: range.from, to: range.to };
}

/** The compiler's spec for a question spec, with exact dates. */
export function toQuerySpec(q: QuestionSpec, cal: Calendar): QuerySpecInput {
  const period = periodOf(q.timeRange, cal);
  return {
    metrics: q.metrics,
    dimensions: q.dimensions,
    filters: q.filters.map((f) => ({
      field: f.field,
      op: f.op,
      value: f.op === 'in' || f.op === 'not_in' ? f.values : f.values[0]!,
    })),
    having: q.having,
    ...(period ? { period } : {}),
    ...(q.compareTo
      ? { compare: q.compareTo === 'same_period_last_year' ? 'previous_year' : 'previous_period' }
      : {}),
    ...(q.orderBy ? { sort: q.orderBy } : {}),
    ...(q.limit ? { limit: q.limit } : {}),
  };
}

/** "Gross profit by product · September 2026" — written by code from the spec. */
const GRAIN_ES = { day: 'día', week: 'semana', month: 'mes', quarter: 'trimestre', year: 'año' };

export function titleFor(
  q: QuestionSpec,
  cal: Calendar,
  labels: { metric: (id: string) => string; dimension: (ref: string) => string },
  lang: Language = 'en',
): string {
  const and = lang === 'es' ? ' y ' : ' and ';
  const metrics = q.metrics.map(labels.metric).join(and);
  const dims = q.dimensions
    .map((d) =>
      'time' in d
        ? lang === 'es'
          ? GRAIN_ES[d.time]
          : `${d.time}`
        : labels.dimension(d.field).toLowerCase(),
    )
    .join(and);
  const period = periodLabel(periodOf(q.timeRange, cal), lang);
  const by = lang === 'es' ? ' por ' : ' by ';
  return `${metrics}${dims ? `${by}${dims}` : ''} · ${period[0]!.toUpperCase()}${period.slice(1)}`;
}
