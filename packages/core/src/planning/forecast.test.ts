import { describe, expect, it } from 'vitest';

import { addDays, forecastDaily, type DayValue } from './forecast';

const SEASON = [0.8, 0.8, 0.9, 0.95, 1, 0.9, 0.8, 0.85, 0.95, 1.05, 1.5, 1.9];
const WEEKDAY = [1.1, 0.9, 0.9, 0.95, 1, 1.1, 1.35]; // Monday … Sunday

const weekdayOf = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
const monthOf = (iso: string) => Number(iso.slice(5, 7)) - 1;

/** `days` of history ending the day before `from`, with value(date, age in days). */
function series(from: string, days: number, value: (date: string, age: number) => number) {
  const out: DayValue[] = [];
  for (let age = days; age >= 1; age--) {
    const date = addDays(from, -age);
    out.push({ date, value: value(date, age) });
  }
  return out;
}

describe('forecastDaily', () => {
  it('needs at least two weeks of history', () => {
    expect(
      forecastDaily(
        series('2026-11-01', 10, () => 100),
        { from: '2026-11-01', days: 30 },
      ),
    ).toBeNull();
  });

  it('carries a flat business forward, with a range', () => {
    const f = forecastDaily(
      series('2026-11-01', 400, () => 100),
      { from: '2026-11-01', days: 30 },
    )!;
    expect(f.method).toBe('seasonal');
    expect(f.days).toHaveLength(30);
    expect(f.days[0]!.date).toBe('2026-11-01');
    expect(f.total).toBeCloseTo(3000, -1);
    expect(f.low).toBeLessThan(f.total);
    expect(f.high).toBeGreaterThan(f.total);
  });

  it('follows the weekday pattern', () => {
    const f = forecastDaily(
      series('2026-11-02', 120, (d) => 100 * WEEKDAY[weekdayOf(d)]!),
      { from: '2026-11-02', days: 7 },
    )!;
    // 2 Nov 2026 is a Monday.
    const ratio = f.days[6]!.estimate / f.days[1]!.estimate;
    expect(ratio).toBeCloseTo(1.35 / 0.9, 1);
  });

  it('knows November is busier than October from last year’s pattern', () => {
    const history = series(
      '2026-11-01',
      730,
      (d) => 100 * SEASON[monthOf(d)]! * WEEKDAY[weekdayOf(d)]!,
    );
    const f = forecastDaily(history, { from: '2026-11-01', days: 30 })!;
    let actual = 0;
    for (let i = 0; i < 30; i++) {
      const d = addDays('2026-11-01', i);
      actual += 100 * SEASON[monthOf(d)]! * WEEKDAY[weekdayOf(d)]!;
    }
    expect(Math.abs(f.total / actual - 1)).toBeLessThan(0.03);
    // A plain run-rate (the last 28 days, carried on) misses the rise by far.
    const runRate = (history.slice(-28).reduce((a, x) => a + x.value, 0) / 28) * 30;
    expect(Math.abs(runRate / actual - 1)).toBeGreaterThan(0.25);
    expect(f.notes).toContainEqual(expect.objectContaining({ kind: 'season', month: 11 }));
  });

  it('allows for growth when there are two years to compare', () => {
    const growth = (age: number) => 1.25 ** (-age / 365);
    const value = (d: string, age: number) => 100 * growth(age) * SEASON[monthOf(d)]!;
    const f = forecastDaily(series('2026-11-01', 760, value), { from: '2026-11-01', days: 30 })!;
    let actual = 0;
    for (let i = 0; i < 30; i++) actual += 100 * 1.25 ** (i / 365) * SEASON[10]!;
    expect(Math.abs(f.total / actual - 1)).toBeLessThan(0.05);
    expect(f.notes).toContainEqual(expect.objectContaining({ kind: 'growth' }));
  });

  it('says when it doesn’t know the season yet', () => {
    const f = forecastDaily(
      series('2026-11-01', 90, () => 50),
      { from: '2026-11-01', days: 30 },
    )!;
    expect(f.method).toBe('recent');
    expect(f.total).toBeCloseTo(1500, -1);
    expect(f.notes).toContainEqual({ kind: 'no_season', historyDays: 90 });
  });

  it('treats missing days as no sales, and never estimates below zero', () => {
    const sparse = series('2026-11-01', 60, (_d, age) => (age % 3 === 0 ? 90 : 0)).filter(
      (x) => x.value > 0,
    );
    const f = forecastDaily(sparse, { from: '2026-11-01', days: 30 })!;
    expect(f.total).toBeGreaterThan(800);
    expect(f.total).toBeLessThan(1000);
    expect(f.days.every((d) => d.estimate >= 0)).toBe(true);
  });

  it('is deterministic', () => {
    const h = series('2026-11-01', 400, (d) => 10 + monthOf(d));
    expect(forecastDaily(h, { from: '2026-11-01', days: 14 })).toEqual(
      forecastDaily(h, { from: '2026-11-01', days: 14 }),
    );
  });
});
