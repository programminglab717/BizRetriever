import type { PackData } from '@bizr/packs';
import { z } from 'zod';

import {
  chartTypes,
  periodOf,
  questionSpecSchema,
  type ChartType,
  type QuestionSpec,
  type TimeRange,
} from '../ask/interpretation';
import { addDays, timePresets, type Calendar } from '../ask/time';

/**
 * Dashboards as plain data (pure, no database): tiles, the edits that change them, and how a tile's
 * question is run for the dashboard's date range. Every change, by chat or by hand, is a list of
 * edit ops applied by `applyOps`, so both paths are checked and versioned the same way.
 */

export const tileSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).max(80),
    spec: questionSpecSchema,
    chart: z.enum(chartTypes),
    /** Width (of 12 columns) and height (rows) on desktop. */
    size: z.tuple([z.number().int().min(2).max(12), z.number().int().min(1).max(8)]),
    /** Keeps its own dates instead of following the dashboard's. */
    fixedDates: z.boolean(),
    /** Weekly, or monthly when the range is longer than 120 days. */
    autoGrain: z.boolean(),
    packKey: z.string().nullable(),
    sourceAnswerId: z.string().uuid().nullable(),
  })
  .strict();
export type Tile = z.infer<typeof tileSchema>;

export const snapshotSchema = z
  .object({ tiles: z.array(tileSchema), removedPackTiles: z.array(z.string()) })
  .strict();
export type DashboardSnapshot = z.infer<typeof snapshotSchema>;

const position = z.union([
  z.enum(['top', 'bottom']),
  z.object({ after: z.string().min(1) }).strict(),
]);
const size = z.tuple([z.number().int().min(2).max(12), z.number().int().min(1).max(8)]);
const title = z.string().trim().min(1).max(80);

export const editOpSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('add_tile'),
      title,
      spec: questionSpecSchema,
      chart: z.enum(chartTypes).optional(),
      position: position.optional(),
      /** True when the request named its own dates ("sales in March"). */
      fixedDates: z.boolean().optional(),
      sourceAnswerId: z.string().uuid().optional(),
    })
    .strict(),
  z.object({ op: z.literal('remove_tile'), tileId: z.string().min(1) }).strict(),
  z
    .object({
      op: z.literal('update_tile'),
      tileId: z.string().min(1),
      title: title.optional(),
      spec: questionSpecSchema.optional(),
      chart: z.enum(chartTypes).optional(),
      size: size.optional(),
      fixedDates: z.boolean().optional(),
    })
    .strict(),
  z.object({ op: z.literal('move_tile'), tileId: z.string().min(1), position }).strict(),
]);
export type EditOp = z.infer<typeof editOpSchema>;

export const editPlanSchema = z
  .object({
    ops: z.array(editOpSchema).max(6),
    summary: z.string().max(300),
    clarify: z
      .object({
        question: z.string().min(1).max(200),
        options: z.array(z.string().max(80)).min(2).max(4),
      })
      .strict()
      .optional(),
  })
  .strict();
export type EditPlan = z.infer<typeof editPlanSchema>;

export class DashboardEditError extends Error {}

/** A sensible size for a chart type. */
export function defaultSize(chart: ChartType): [number, number] {
  switch (chart) {
    case 'kpi':
      return [3, 2];
    case 'line':
    case 'stacked_bar':
      return [8, 4];
    case 'table':
      return [6, 5];
    default:
      return [6, 4];
  }
}

/**
 * Applies edits to a copy of the tiles. Throws `DashboardEditError` (plain message) when an edit
 * names a tile that isn't there. `newId` makes ids deterministic in tests.
 */
export function applyOps(
  snapshot: DashboardSnapshot,
  ops: readonly EditOp[],
  newId: () => string = () => crypto.randomUUID(),
): { snapshot: DashboardSnapshot; changes: string[] } {
  let tiles = [...snapshot.tiles];
  const removed = new Set(snapshot.removedPackTiles);
  const changes: string[] = [];
  const find = (id: string) => {
    const i = tiles.findIndex((t) => t.id === id);
    if (i < 0) throw new DashboardEditError('That tile isn’t on your dashboard any more.');
    return i;
  };
  const place = (t: Tile, pos: z.infer<typeof position> | undefined) => {
    if (!pos || pos === 'top') tiles = [t, ...tiles];
    else if (pos === 'bottom') tiles = [...tiles, t];
    else {
      const i = find(pos.after);
      tiles = [...tiles.slice(0, i + 1), t, ...tiles.slice(i + 1)];
    }
  };
  for (const op of ops) {
    switch (op.op) {
      case 'add_tile': {
        const chart = op.chart ?? chartForSpec(op.spec);
        place(
          {
            id: newId(),
            title: op.title,
            spec: op.spec,
            chart,
            size: defaultSize(chart),
            fixedDates: op.fixedDates ?? false,
            autoGrain: false,
            packKey: null,
            sourceAnswerId: op.sourceAnswerId ?? null,
          },
          op.position,
        );
        changes.push(`Add “${op.title}”`);
        break;
      }
      case 'remove_tile': {
        const t = tiles[find(op.tileId)]!;
        tiles = tiles.filter((x) => x.id !== op.tileId);
        if (t.packKey) removed.add(t.packKey);
        changes.push(`Remove “${t.title}”`);
        break;
      }
      case 'update_tile': {
        const i = find(op.tileId);
        const t = tiles[i]!;
        const next: Tile = {
          ...t,
          ...(op.title ? { title: op.title } : {}),
          ...(op.spec ? { spec: op.spec, autoGrain: false } : {}),
          ...(op.chart ? { chart: op.chart } : {}),
          ...(op.size ? { size: op.size } : {}),
          ...(op.fixedDates !== undefined ? { fixedDates: op.fixedDates } : {}),
        };
        tiles = tiles.map((x, n) => (n === i ? next : x));
        if (op.title && op.title !== t.title) changes.push(`Rename “${t.title}” to “${op.title}”`);
        if (op.chart && op.chart !== t.chart)
          changes.push(`Show “${next.title}” as ${chartName(op.chart)}`);
        if (op.spec) changes.push(`Change what “${next.title}” shows`);
        if (op.size) changes.push(`Resize “${next.title}”`);
        if (op.fixedDates !== undefined && op.fixedDates !== t.fixedDates)
          changes.push(
            op.fixedDates
              ? `Keep the dates of “${next.title}”`
              : `“${next.title}” follows the dashboard dates`,
          );
        break;
      }
      case 'move_tile': {
        const t = tiles[find(op.tileId)]!;
        if (typeof op.position === 'object' && op.position.after === op.tileId) break;
        tiles = tiles.filter((x) => x.id !== op.tileId);
        place(t, op.position);
        changes.push(`Move “${t.title}”`);
        break;
      }
    }
  }
  return { snapshot: { tiles, removedPackTiles: [...removed] }, changes };
}

/** The usual chart for a question's shape, before any data is seen. */
export function chartForSpec(spec: QuestionSpec): ChartType {
  const time = spec.dimensions.filter((d) => 'time' in d).length;
  const fields = spec.dimensions.length - time;
  if (spec.dimensions.length === 0) return 'kpi';
  if (spec.having.length > 0 || (spec.dimensions.length > 1 && !(time === 1 && fields === 1)))
    return 'table';
  if (time === 1) return fields === 1 ? 'stacked_bar' : 'line';
  return spec.limit !== undefined && spec.limit <= 15 ? 'bar_horizontal' : 'table';
}

export function chartName(chart: ChartType): string {
  return {
    kpi: 'a number',
    line: 'a line chart',
    bar: 'a bar chart',
    bar_horizontal: 'a bar chart',
    stacked_bar: 'a stacked bar chart',
    table: 'a table',
  }[chart];
}

/** The pack's tiles this workspace can show now, minus the ones the owner removed. */
export function packTilesFor(
  pack: Pick<PackData, 'dashboard'>,
  available: ReadonlySet<string>,
  removed: ReadonlySet<string> = new Set(),
  newId: () => string = () => crypto.randomUUID(),
): { tiles: Tile[]; skipped: string[] } {
  const tiles: Tile[] = [];
  const skipped: string[] = [];
  for (const t of pack.dashboard.tiles) {
    if (removed.has(t.id)) continue;
    if (!t.spec.metrics.every((m) => available.has(m))) {
      skipped.push(t.id);
      continue;
    }
    tiles.push({
      id: newId(),
      title: t.title,
      spec: questionSpecSchema.parse({ ...t.spec, timeRange: { preset: 'all_time' } }),
      chart: t.chart,
      size: t.size,
      fixedDates: false,
      autoGrain: t.auto_grain,
      packKey: t.id,
      sourceAnswerId: null,
    });
  }
  return { tiles, skipped };
}

// --- Running a tile for the dashboard's dates ---------------------------------------------------

export const dashboardRangeSchema = z
  .object({
    range: z.union([
      z.object({ preset: z.enum(timePresets) }).strict(),
      z
        .object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
        .strict(),
    ]),
    compare: z.boolean(),
  })
  .strict();
export type DashboardRange = z.infer<typeof dashboardRangeSchema>;

const dayCount = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * The question a tile asks for the dashboard's dates: its own dates when fixed, else the range;
 * a comparison on headline numbers when compare is on; weekly or monthly for auto-grain tiles.
 */
export function tileSpec(
  tile: Tile,
  range: DashboardRange,
  cal: Calendar,
  isSnapshot: (metric: string) => boolean,
): QuestionSpec {
  const timeRange: TimeRange = tile.fixedDates ? tile.spec.timeRange : range.range;
  const period = periodOf(timeRange, cal);
  let dimensions = tile.spec.dimensions;
  if (tile.autoGrain) {
    const days = period ? dayCount(period.from, period.to) : Infinity;
    const grain = days > 120 ? 'month' : 'week';
    dimensions = dimensions.map((d) => ('time' in d ? { time: grain } : d));
  }
  // Fixed-date tiles keep their own comparison; the others compare headline numbers when asked.
  const { compareTo: own, ...rest } = tile.spec;
  const compareTo = tile.fixedDates
    ? own
    : range.compare && tile.chart === 'kpi' && !tile.spec.metrics.every(isSnapshot) && period
      ? ('previous_period' as const)
      : undefined;
  return { ...rest, dimensions, timeRange, ...(compareTo ? { compareTo } : {}) };
}

/** "Last 30 days" etc. for the date picker. */
export const RANGE_PRESETS: { preset: (typeof timePresets)[number]; label: string }[] = [
  { preset: 'last_7_days', label: 'Last 7 days' },
  { preset: 'last_30_days', label: 'Last 30 days' },
  { preset: 'this_month', label: 'This month' },
  { preset: 'last_month', label: 'Last month' },
  { preset: 'last_90_days', label: 'Last 90 days' },
  { preset: 'this_quarter', label: 'This quarter' },
  { preset: 'this_year', label: 'This year' },
  { preset: 'last_year', label: 'Last year' },
];

/** The custom range "to" date as the day after the last day shown. */
export function inclusiveRange(from: string, lastDay: string): { from: string; to: string } {
  return { from, to: addDays(lastDay, 1) };
}
