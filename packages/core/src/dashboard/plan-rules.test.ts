import { getPack } from '@bizr/packs';
import { describe, expect, it } from 'vitest';

import { fixtureCatalog } from '../ask/fixtures';
import { packTilesFor, type Tile } from './model';
import { matchTiles, planWithRules, type PlanContext } from './plan-rules';

const pack = getPack('retail');
const catalog = fixtureCatalog();
let n = 0;
const tiles: Tile[] = packTilesFor(
  pack,
  new Set(pack.metrics.metrics.map((m) => m.id)),
  new Set(),
  () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
).tiles;
const ctx: PlanContext = {
  catalog,
  labels: {
    metric: (id) => catalog.metrics.find((m) => m.id === id)?.label ?? id,
    dimension: (f) => catalog.dimensions.find((d) => d.field === f)?.label ?? f,
  },
};
const tile = (key: string) => tiles.find((t) => t.packKey === key)!;
const plan = (r: string) => planWithRules(r, tiles, ctx);

describe('planWithRules', () => {
  it('adds a chart from a question', () => {
    const p = plan('Add a chart of sales by city');
    expect(p?.ops).toEqual([
      {
        op: 'add_tile',
        title: 'Net sales by city',
        spec: {
          metrics: ['net_sales'],
          dimensions: [{ field: 'customer.city' }],
          filters: [],
          having: [],
          timeRange: { preset: 'all_time' },
          orderBy: { by: 'net_sales', dir: 'desc' },
        },
        position: 'top',
        fixedDates: false,
      },
    ]);
    expect(plan('add a line chart of orders by month')?.ops[0]).toMatchObject({ chart: 'line' });
    expect(plan('add a table of top 5 products by profit')?.ops[0]).toMatchObject({
      chart: 'table',
      spec: { limit: 5 },
    });
    expect(plan('add sales in March')?.ops[0]).toMatchObject({ fixedDates: true });
  });

  it('removes, renames, moves and changes tiles', () => {
    expect(plan('remove the top customers table')?.ops).toEqual([
      { op: 'remove_tile', tileId: tile('top_customers').id },
    ]);
    expect(plan('Rename orders to Number of orders')?.ops).toEqual([
      { op: 'update_tile', tileId: tile('orders').id, title: 'Number of orders' },
    ]);
    expect(plan('move running low to the top')?.ops).toEqual([
      { op: 'move_tile', tileId: tile('running_low').id, position: 'top' },
    ]);
    expect(plan('show top customers as a bar chart')?.ops).toEqual([
      { op: 'update_tile', tileId: tile('top_customers').id, chart: 'bar_horizontal' },
    ]);
  });

  it('switches over-time tiles to another grain', () => {
    const p = plan('show sales monthly instead of weekly');
    expect(p?.ops).toEqual([
      {
        op: 'update_tile',
        tileId: tile('sales_over_time').id,
        spec: { ...tile('sales_over_time').spec, dimensions: [{ time: 'month' }] },
      },
    ]);
    expect(plan('make it daily')?.ops[0]).toMatchObject({ tileId: tile('sales_over_time').id });
  });

  it('asks which tile when more than one fits', () => {
    const p = plan('remove the profit chart');
    expect(p?.ops).toEqual([]);
    expect(p?.clarify?.options).toEqual(
      expect.arrayContaining(['Gross profit', 'Top products by profit']),
    );
  });

  it('hands over what it doesn’t recognise', () => {
    expect(plan('make the dashboard prettier')).toBeNull();
    expect(plan('remove the weather chart')).toBeNull();
    expect(plan('show me sales by month')).toBeNull();
    expect(plan('add something nice')).toBeNull();
  });

  it('matches tiles by title words and measure words', () => {
    expect(matchTiles('slow stock list', tiles, ctx).map((t) => t.packKey)).toEqual(['slow_stock']);
    expect(matchTiles('slow stock number', tiles, ctx).map((t) => t.packKey)).toEqual([
      'slow_stock_total',
    ]);
    expect(matchTiles('margins', tiles, ctx).map((t) => t.packKey)).toEqual(['margin_by_category']);
  });
});
