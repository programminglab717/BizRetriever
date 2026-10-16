import { getPack } from '@bizr/packs';
import { describe, expect, it } from 'vitest';

import type { Calendar } from '../ask/time';
import {
  applyOps,
  DashboardEditError,
  packTilesFor,
  tileSpec,
  type DashboardSnapshot,
} from './model';

const pack = getPack('retail');
const cal: Calendar = { today: '2026-10-13', weekStart: 1, fiscalYearStartMonth: 1 };
const ids = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
};
const all = new Set(pack.metrics.metrics.map((m) => m.id));
const snapshotIds = new Set(pack.metrics.metrics.filter((m) => m.snapshot).map((m) => m.id));
const isSnapshot = (id: string) => snapshotIds.has(id);

describe('packTilesFor', () => {
  it('builds the pack dashboard and leaves out what the data can’t show', () => {
    const full = packTilesFor(pack, all, new Set(), ids());
    expect(full.tiles.map((t) => t.packKey)).toEqual(pack.dashboard.tiles.map((t) => t.id));
    expect(full.skipped).toEqual([]);
    const noCosts = new Set(
      [...all].filter((m) => !['gross_profit', 'gross_margin_pct'].includes(m)),
    );
    const partial = packTilesFor(pack, noCosts, new Set(['top_customers']), ids());
    expect(partial.skipped).toEqual(['gross_profit', 'top_products_profit', 'margin_by_category']);
    expect(partial.tiles.map((t) => t.packKey)).not.toContain('top_customers');
  });
});

describe('applyOps', () => {
  const start = (): DashboardSnapshot => ({
    tiles: packTilesFor(pack, all, new Set(), ids()).tiles.slice(0, 3),
    removedPackTiles: [],
  });

  it('adds, removes, updates and moves tiles, recording removed pack tiles', () => {
    const s = start();
    const [a, b, c] = s.tiles;
    const { snapshot, changes } = applyOps(
      s,
      [
        {
          op: 'add_tile',
          title: 'Sales by city',
          spec: { ...a!.spec, dimensions: [{ field: 'customer.city' }] },
          chart: 'bar_horizontal',
          position: 'bottom',
        },
        { op: 'remove_tile', tileId: b!.id },
        { op: 'update_tile', tileId: c!.id, title: 'Number of orders', chart: 'table' },
        { op: 'move_tile', tileId: c!.id, position: 'top' },
      ],
      () => '00000000-0000-4000-8000-000000000099',
    );
    expect(snapshot.tiles.map((t) => t.title)).toEqual([
      'Number of orders',
      'Net sales',
      'Sales by city',
    ]);
    expect(snapshot.tiles[2]).toMatchObject({ size: [6, 4], fixedDates: false, packKey: null });
    expect(snapshot.removedPackTiles).toEqual(['gross_profit']);
    expect(changes).toEqual([
      'Add “Sales by city”',
      'Remove “Gross profit”',
      'Rename “Orders” to “Number of orders”',
      'Show “Number of orders” as a table',
      'Move “Number of orders”',
    ]);
    // The input is untouched.
    expect(s.tiles).toHaveLength(3);
  });

  it('refuses edits to tiles that aren’t there', () => {
    expect(() => applyOps(start(), [{ op: 'remove_tile', tileId: 'nope' }])).toThrow(
      DashboardEditError,
    );
  });
});

describe('tileSpec', () => {
  const tiles = packTilesFor(pack, all, new Set(), ids()).tiles;
  const tile = (key: string) => tiles.find((t) => t.packKey === key)!;
  const range = { range: { preset: 'last_30_days' as const }, compare: true };

  it('follows the dashboard dates and compares headline numbers', () => {
    expect(tileSpec(tile('net_sales'), range, cal, isSnapshot)).toMatchObject({
      timeRange: { preset: 'last_30_days' },
      compareTo: 'previous_period',
    });
    expect(tileSpec(tile('sales_by_channel'), range, cal, isSnapshot).compareTo).toBeUndefined();
    expect(tileSpec(tile('slow_stock_total'), range, cal, isSnapshot).compareTo).toBeUndefined();
    expect(
      tileSpec(tile('net_sales'), { ...range, compare: false }, cal, isSnapshot).compareTo,
    ).toBeUndefined();
  });

  it('goes monthly for long ranges and keeps fixed dates', () => {
    const t = tile('sales_over_time');
    expect(tileSpec(t, range, cal, isSnapshot).dimensions).toEqual([{ time: 'week' }]);
    expect(
      tileSpec(t, { range: { preset: 'this_year' }, compare: false }, cal, isSnapshot).dimensions,
    ).toEqual([{ time: 'month' }]);
    const fixed = {
      ...tile('net_sales'),
      fixedDates: true,
      spec: { ...tile('net_sales').spec, timeRange: { from: '2026-03-01', to: '2026-04-01' } },
    };
    expect(tileSpec(fixed, range, cal, isSnapshot)).toMatchObject({
      timeRange: { from: '2026-03-01', to: '2026-04-01' },
    });
    expect(tileSpec(fixed, range, cal, isSnapshot).compareTo).toBeUndefined();
  });
});
