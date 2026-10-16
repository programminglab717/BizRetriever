import { z } from 'zod';

import type { PackMetrics } from './metrics';

/**
 * The pack's default dashboard (VERTICAL_PACKS §2.6). Each tile is a question spec without dates:
 * tiles follow the dashboard's date range. Tiles whose measures aren't available are left out, and
 * added later when an import makes them available.
 */

const fieldRef = z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, 'entity.field');
const id = z.string().regex(/^[a-z][a-z0-9_]*$/);

export const dashboardCharts = [
  'kpi',
  'line',
  'bar',
  'bar_horizontal',
  'stacked_bar',
  'table',
] as const;
export const dashboardPresets = [
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'this_month',
  'last_month',
  'this_quarter',
  'this_year',
] as const;

export const packTileSchema = z
  .object({
    id,
    title: z.string().min(1).max(80),
    chart: z.enum(dashboardCharts),
    /** Width (of 12 columns) and height (rows) on desktop. */
    size: z.tuple([z.number().int().min(2).max(12), z.number().int().min(1).max(8)]),
    spec: z
      .object({
        metrics: z.array(id).min(1).max(4),
        dimensions: z
          .array(
            z.union([
              z.object({ field: fieldRef }).strict(),
              z.object({ time: z.enum(['day', 'week', 'month', 'quarter', 'year']) }).strict(),
            ]),
          )
          .max(2)
          .default([]),
        filters: z
          .array(
            z
              .object({
                field: fieldRef,
                op: z.enum(['eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'contains']),
                values: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1),
              })
              .strict(),
          )
          .default([]),
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
        orderBy: z
          .object({ by: id, dir: z.enum(['asc', 'desc']) })
          .strict()
          .optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .strict(),
    /** Over-time tiles: weekly, or monthly when the range is longer than 120 days. */
    auto_grain: z.boolean().default(false),
  })
  .strict();
export type PackTile = z.infer<typeof packTileSchema>;

export const packDashboardFileSchema = z
  .object({
    default_range: z
      .object({ preset: z.enum(dashboardPresets), compare: z.boolean().default(true) })
      .strict(),
    tiles: z.array(packTileSchema).min(1),
  })
  .strict();
export type PackDashboard = z.infer<typeof packDashboardFileSchema>;

export function checkDashboard(metrics: PackMetrics, dashboard: PackDashboard): string[] {
  const ids = new Set(metrics.metrics.map((m) => m.id));
  const dims = new Set(metrics.dimensions.map((d) => d.field));
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const t of dashboard.tiles) {
    if (seen.has(t.id)) problems.push(`tile "${t.id}" is listed twice`);
    seen.add(t.id);
    for (const m of [...t.spec.metrics, ...t.spec.having.map((h) => h.metric)])
      if (!ids.has(m)) problems.push(`tile "${t.id}" uses unknown measure "${m}"`);
    for (const d of t.spec.dimensions)
      if ('field' in d && !dims.has(d.field))
        problems.push(`tile "${t.id}" breaks down by "${d.field}", which isn't a pack breakdown`);
    for (const h of t.spec.having)
      if (!t.spec.metrics.includes(h.metric))
        problems.push(`tile "${t.id}" filters on "${h.metric}" without showing it`);
    if (t.auto_grain && !t.spec.dimensions.some((d) => 'time' in d))
      problems.push(`tile "${t.id}" has auto_grain but no time breakdown`);
  }
  return problems;
}
