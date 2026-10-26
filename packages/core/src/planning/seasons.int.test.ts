import { closePools } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadDemoWorkspace, type DemoWorkspace } from '../testing/demo-workspace';
import { addDays } from './forecast';
import { reorderList } from './reorder';

/**
 * M12 acceptance (ADR-061): on the demo shop with two years of trading, a reorder list made in
 * mid-October includes the Christmas products (not selling yet), with quantities in line with what
 * they sold in the same weeks the year before.
 */
const hasDb = await databaseAvailable();
const TODAY = '2026-10-15';
const CHRISTMAS = ['Advent Candle', 'Christmas Card Pack', 'Gingerbread Cutter Set'];

describe.skipIf(!hasDb)('per-product seasons (integration)', () => {
  let demo: DemoWorkspace;

  beforeAll(async () => {
    demo = await loadDemoWorkspace({ today: TODAY, historyDays: 760, name: 'Fernwood Seasons' });
  }, 480_000);
  afterAll(async () => {
    await demo?.dispose();
    await closePools();
  });

  it('suggests Christmas stock before Christmas, from last year’s same weeks', async () => {
    const list = await reorderList(demo.member, { now: new Date(`${TODAY}T16:00:00Z`) });
    expect(list.perProductSeasons).toBe(true);
    for (const name of CHRISTMAS) {
      const line = list.lines.find((l) => l.product === name);
      expect(line, name).toBeDefined();
      expect(line!.seasonal).toBe(true);
      // What the simulation sold in those weeks a year ago (completed sales, all channels).
      const from = addDays(TODAY, -364);
      const to = addDays(from, line!.coverDays);
      let sold = 0;
      for (const s of demo.sim.sales)
        if (s.status === 'completed' && s.date >= from && s.date < to)
          for (const l of s.lines) if (l.product.name === name) sold += l.qty;
      expect(line!.lastYear!).toBeGreaterThan(0);
      expect(Math.abs(line!.lastYear! / sold - 1)).toBeLessThan(0.1);
      // In line with last year (scaled by how the shop is doing), less what's in stock.
      expect(line!.suggested).toBeGreaterThan(sold * 0.5 - line!.onHand);
      expect(line!.suggested).toBeLessThan(sold * 2);
    }
  }, 120_000);
});
