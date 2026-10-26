import { simulateDemo } from '@bizr/demo-data';
import { describe, expect, it } from 'vitest';

import { addDays, forecastDaily, type DayValue } from './forecast';

/**
 * M11 acceptance: on the demo shop with two years of trading, the November estimate made on 1
 * November (from earlier days only) is within 15% of what was sold, and closer than a run-rate.
 */
describe('back-test on the demo shop', () => {
  const sim = simulateDemo({ today: '2026-12-01', historyDays: 760 });
  const byDay = new Map<string, number>();
  for (const s of sim.sales) {
    if (s.status !== 'completed' || s.channel === 'wholesale') continue;
    const value = s.lines.reduce((a, l) => a + l.qty * l.unitPrice - l.discount, 0) / 100;
    byDay.set(s.date, (byDay.get(s.date) ?? 0) + value);
  }
  const history: DayValue[] = [...byDay].map(([date, value]) => ({ date, value }));
  const actual = (from: string, days: number) => {
    let total = 0;
    for (let i = 0; i < days; i++) total += byDay.get(addDays(from, i)) ?? 0;
    return total;
  };

  it('estimates November within 15%, and beats the run-rate', () => {
    const from = '2026-11-01';
    const f = forecastDaily(history, { from, days: 30 })!;
    const sold = actual(from, 30);
    const err = Math.abs(f.total / sold - 1);
    const runRate = (actual(addDays(from, -28), 28) / 28) * 30;
    expect(f.method).toBe('seasonal');
    expect(err).toBeLessThan(0.15);
    expect(err).toBeLessThan(Math.abs(runRate / sold - 1));
    // What was sold falls inside the range shown.
    expect(sold).toBeGreaterThanOrEqual(f.low);
    expect(sold).toBeLessThanOrEqual(f.high);
  });

  it('stays close on a quiet month too (the next 4 weeks from 1 March)', () => {
    const f = forecastDaily(history, { from: '2026-03-01', days: 28 })!;
    expect(Math.abs(f.total / actual('2026-03-01', 28) - 1)).toBeLessThan(0.15);
  });
});
