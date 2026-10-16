import { z } from 'zod';

/**
 * A query spec (ADR-007): the typed form of a question ("net sales by channel last month vs the month
 * before"). The AI may produce one (M4), but only this compiler turns it into SQL.
 */

const fieldRef = z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const timeGrains = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type TimeGrain = (typeof timeGrains)[number];

export const dimensionSchema = z.union([
  z.object({ field: fieldRef }).strict(),
  z.object({ time: z.enum(timeGrains) }).strict(),
]);
export type Dimension = z.infer<typeof dimensionSchema>;

const filterValue = z.union([z.string().max(200), z.number(), z.boolean()]);

export const filterSchema = z
  .object({
    field: fieldRef,
    op: z.enum(['eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'contains']),
    value: z.union([filterValue, z.array(filterValue).min(1).max(100)]),
  })
  .strict();
export type Filter = z.infer<typeof filterSchema>;

export const querySpecSchema = z
  .object({
    metrics: z
      .array(z.string().regex(/^[a-z][a-z0-9_]*$/))
      .min(1)
      .max(6),
    dimensions: z.array(dimensionSchema).max(3).default([]),
    filters: z.array(filterSchema).max(10).default([]),
    /** `to` is exclusive. Omitted: everything up to and including today. */
    period: z.object({ from: isoDate, to: isoDate }).strict().optional(),
    compare: z.enum(['previous_period', 'previous_year']).optional(),
    /** Keep only rows whose metric meets these (e.g. unsold stock value > 0). */
    having: z
      .array(
        z
          .object({
            metric: z.string().regex(/^[a-z][a-z0-9_]*$/),
            op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']),
            value: z.number(),
          })
          .strict(),
      )
      .max(3)
      .default([]),
    sort: z
      .object({
        /** A metric id, or `d0`, `d1`… for a dimension. */
        by: z.string().regex(/^[a-z][a-z0-9_]*$/),
        dir: z.enum(['asc', 'desc']).default('desc'),
      })
      .strict()
      .optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.period && s.period.from >= s.period.to)
      ctx.addIssue({ code: 'custom', message: 'period.from must be before period.to' });
    if (s.compare && s.dimensions.some((d) => 'time' in d))
      ctx.addIssue({ code: 'custom', message: 'compare can’t be combined with a time breakdown' });
  });
export type QuerySpec = z.infer<typeof querySpecSchema>;
export type QuerySpecInput = z.input<typeof querySpecSchema>;
