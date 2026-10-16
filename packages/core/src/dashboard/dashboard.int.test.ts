import { closePools } from '@bizr/db';
import { getPack } from '@bizr/packs';
import { databaseAvailable } from '@bizr/platform/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pinAnswer, askQuestion, unpinTile } from '../ask/service';
import { resolvePreset } from '../ask/time';
import { runQuery } from '../semantic/service';
import { loadDemoWorkspace, type DemoWorkspace } from '../testing/demo-workspace';
import { DashboardEditError } from './model';
import {
  applyDashboardEdit,
  currentDashboard,
  dashboardView,
  ensureDefaultDashboard,
  undoDashboardEdit,
} from './service';

/** The default dashboard on the demo data: generated, correct, dated, editable and undoable. */
const hasDb = await databaseAvailable();
const TZ = 'America/New_York';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const pack = getPack('retail');

describe.skipIf(!hasDb)('default dashboard (integration)', () => {
  let demo: DemoWorkspace;
  beforeAll(async () => {
    demo = await loadDemoWorkspace({ today, timezone: TZ, name: 'Fernwood Dashboard Test' });
  }, 120_000);
  afterAll(async () => {
    await demo?.dispose();
    await closePools();
  });

  it('is built from the pack after the import, with every tile loading', async () => {
    const view = await dashboardView(demo.member);
    expect(view.tiles.map((t) => t.packKey)).toEqual(pack.dashboard.tiles.map((t) => t.id));
    expect(view.tiles.filter((t) => t.error)).toEqual([]);
    expect(view.range).toEqual({ range: { preset: 'last_30_days' }, compare: true });
    expect(view.unlock).toEqual([]);
    expect(view.canUndo).toBe(false);

    // The headline number is the real one, compared with the 30 days before.
    const cal = { today, weekStart: 1, fiscalYearStartMonth: 1 };
    const direct = await runQuery(
      demo.member,
      { metrics: ['net_sales'], period: resolvePreset('last_30_days', cal)! },
      'system',
    );
    const kpi = view.tiles.find((t) => t.packKey === 'net_sales')!.kpis![0]!;
    const shown = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
      String(direct.rows[0]!.m_net_sales) as unknown as number,
    );
    expect(kpi.text).toBe(shown);
    expect(kpi.change).toBeDefined();
    // "Running low" lists only products with under 14 days left.
    const low = view.tiles.find((t) => t.packKey === 'running_low')!.table!;
    expect(low.rows.every((r) => (r.cells[1]!.value ?? 0) < 14)).toBe(true);
  }, 60_000);

  it('follows the date range: monthly over a year, no comparison when it’s off', async () => {
    const view = await dashboardView(demo.member, {
      range: { preset: 'this_year' },
      compare: false,
    });
    const over = view.tiles.find((t) => t.packKey === 'sales_over_time')!.table!;
    expect(over.columns[0]!.label).toBe('Month');
    expect(view.tiles.find((t) => t.packKey === 'net_sales')!.kpis![0]!.change).toBeUndefined();
  }, 60_000);

  it('edits, undoes, and doesn’t bring back removed pack tiles', async () => {
    const before = await currentDashboard(demo.member);
    const customers = before.tiles.find((t) => t.packKey === 'top_customers')!;
    const r = await applyDashboardEdit(demo.member, demo.ownerId, [
      { op: 'remove_tile', tileId: customers.id },
      {
        op: 'add_tile',
        title: 'Sales by city',
        spec: {
          metrics: ['net_sales'],
          dimensions: [{ field: 'customer.city' }],
          filters: [],
          having: [],
          timeRange: { preset: 'all_time' },
        },
        chart: 'bar_horizontal',
        position: 'bottom',
      },
    ]);
    expect(r.changes).toEqual(['Remove “Top customers”', 'Add “Sales by city”']);
    expect((await ensureDefaultDashboard(demo.member.workspace)).added).toBe(0);
    const view = await dashboardView(demo.member);
    expect(view.tiles.at(-1)!.title).toBe('Sales by city');
    expect(view.tiles.at(-1)!.error).toBeUndefined();
    expect(view.tiles.at(-1)!.table!.rows.length).toBeGreaterThan(1);
    expect(view.tiles.some((t) => t.packKey === 'top_customers')).toBe(false);
    expect(view.canUndo).toBe(true);

    expect((await undoDashboardEdit(demo.member, demo.ownerId)).undone).toMatch(
      /Remove “Top customers”/,
    );
    const restored = await currentDashboard(demo.member);
    expect(restored.tiles.map((t) => t.id)).toEqual(before.tiles.map((t) => t.id));
  }, 60_000);

  it('refuses edits that don’t make sense for the data', async () => {
    await expect(
      applyDashboardEdit(demo.member, null, [
        {
          op: 'add_tile',
          title: 'Bad',
          spec: {
            metrics: ['expenses_total'],
            dimensions: [{ field: 'sale.channel' }],
            filters: [],
            having: [],
            timeRange: { preset: 'all_time' },
          },
        },
      ]),
    ).rejects.toBeInstanceOf(DashboardEditError);
  });

  it('pins answers at the top, and Undo takes them off', async () => {
    const a = await askQuestion(
      demo.member,
      demo.ownerId,
      { question: 'sales in March' },
      { provider: null, aiMode: 'never' },
    );
    const tileId = await pinAnswer(demo.member, a.answerId);
    const pinned = (await currentDashboard(demo.member)).tiles[0]!;
    expect(pinned).toMatchObject({ id: tileId, fixedDates: true, title: 'Net sales' });
    const view = await dashboardView(demo.member);
    expect(view.tiles[0]!.datesLabel).toMatch(/^March /);
    await unpinTile(demo.member, tileId);
    expect((await currentDashboard(demo.member)).tiles.some((t) => t.id === tileId)).toBe(false);
  }, 60_000);
});
