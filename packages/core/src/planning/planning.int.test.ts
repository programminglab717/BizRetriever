import { closePools } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { toAnswerData } from '../ask/answer';
import { runQuery } from '../semantic/service';
import { loadDemoWorkspace, type DemoWorkspace } from '../testing/demo-workspace';
import { addDays } from './forecast';
import { goalProgress, listGoals, removeGoal, setGoal } from './goals';
import { reorderList } from './reorder';
import { dailyHistory, estimateMetric, PlanningError } from './service';

/** M11 (ADR-060): estimates, goals and the reorder list agree with the numbers shown elsewhere. */
const hasDb = await databaseAvailable();

describe.skipIf(!hasDb)('planning (integration)', () => {
  let demo: DemoWorkspace;
  const total = async (metric: string, from: string, to: string) => {
    const r = toAnswerData(
      await runQuery(demo.member, { metrics: [metric], period: { from, to } }, 'system'),
    );
    return r.rows[0]?.[r.columns[0]!.key] ?? null;
  };

  beforeAll(async () => {
    demo = await loadDemoWorkspace({ today: '2026-10-13', name: 'Fernwood Planning Test' });
  }, 240_000);
  afterAll(async () => {
    await demo?.dispose();
    await closePools();
  });

  it('builds its history from the same measure as every other answer', async () => {
    const h = await dailyHistory(demo.member, 'net_sales');
    const september = h.history
      .filter((d) => d.date >= '2026-09-01' && d.date < '2026-10-01')
      .reduce((a, d) => a + d.value, 0);
    expect(september).toBeCloseTo(Number(await total('net_sales', '2026-09-01', '2026-10-01')), 2);
    expect(h.history.every((d) => d.date < h.today)).toBe(true);
  });

  it('estimates the next 30 days with a range, knowing the season from a year of history', async () => {
    const e = await estimateMetric(demo.member, 'net_sales', { days: 30 });
    expect(e.metric).toMatchObject({ id: 'net_sales', format: 'money' });
    const f = e.forecast!;
    expect(f.method).toBe('seasonal');
    expect(f.days[0]!.date).toBe(e.from);
    expect(f.low).toBeLessThan(f.total);
    expect(f.high).toBeGreaterThan(f.total);
    await expect(estimateMetric(demo.member, 'gross_margin_pct', { days: 30 })).rejects.toThrow(
      PlanningError,
    );
  });

  it('sets a goal, shows this month so far exactly, and where the month is heading', async () => {
    await expect(setGoal(demo.member, demo.ownerId, 'net_sales', 'lots')).rejects.toThrow(
      /as a number/,
    );
    await expect(setGoal(demo.member, demo.ownerId, 'stock_on_hand', '10')).rejects.toThrow(
      /can’t set a goal/,
    );
    await setGoal(demo.member, demo.ownerId, 'net_sales', '$12,000');
    expect(await listGoals(demo.member)).toEqual([{ metricKey: 'net_sales', target: '12000' }]);
    const [g] = await goalProgress(demo.member);
    expect(g!.target).toBe('12000');
    const today = (await dailyHistory(demo.member, 'net_sales')).today;
    expect(g!.soFar).toBe(await total('net_sales', g!.month.from, addDays(today, 1)));
    expect(g!.projected).not.toBeNull();
    expect(g!.projected!.total).toBeGreaterThanOrEqual(0);
    expect(['reached', 'ahead', 'on_track', 'behind']).toContain(g!.status);
    expect(g!.daysLeft).toBeGreaterThan(0);
    await setGoal(demo.member, demo.ownerId, 'net_sales', '15000');
    expect((await listGoals(demo.member))[0]!.target).toBe('15000');
    await removeGoal(demo.member, demo.ownerId, 'net_sales');
    expect(await goalProgress(demo.member)).toEqual([]);
  });

  it('lists what to reorder, soonest first, with quantities covering lead time + 30 days', async () => {
    const list = await reorderList(demo.member);
    expect(list.available).toBe(true);
    expect(list.lines.length).toBeGreaterThan(0);
    const covers = list.lines.map((l) => l.daysOfCover);
    expect(covers).toEqual([...covers].sort((a, b) => a - b));
    for (const l of list.lines) {
      expect(l.coverDays).toBe(l.leadDays + 30);
      expect(l.suggested).toBe(
        Math.max(0, Math.ceil(l.perDay * l.coverDays * list.seasonFactor - l.onHand)),
      );
      expect(l.suggested).toBeGreaterThan(0);
    }
  });
});
