import { describe, expect, it } from 'vitest';

import { namedMonth, periodLabel, resolvePreset, type Calendar } from './time';

const cal: Calendar = { today: '2026-10-13', weekStart: 1, fiscalYearStartMonth: 1 };

describe('resolvePreset', () => {
  it.each([
    ['today', { from: '2026-10-13', to: '2026-10-14' }],
    ['yesterday', { from: '2026-10-12', to: '2026-10-13' }],
    ['last_7_days', { from: '2026-10-07', to: '2026-10-14' }],
    ['this_week', { from: '2026-10-12', to: '2026-10-14' }],
    ['last_week', { from: '2026-10-05', to: '2026-10-12' }],
    ['this_month', { from: '2026-10-01', to: '2026-10-14' }],
    ['last_month', { from: '2026-09-01', to: '2026-10-01' }],
    ['this_quarter', { from: '2026-10-01', to: '2026-10-14' }],
    ['last_quarter', { from: '2026-07-01', to: '2026-10-01' }],
    ['this_year', { from: '2026-01-01', to: '2026-10-14' }],
    ['last_year', { from: '2025-01-01', to: '2026-01-01' }],
  ] as const)('%s', (preset, want) => {
    expect(resolvePreset(preset, cal)).toEqual(want);
  });

  it('uses the week start and fiscal year', () => {
    expect(resolvePreset('this_week', { ...cal, weekStart: 7 })).toEqual({
      from: '2026-10-11',
      to: '2026-10-14',
    });
    const april = { ...cal, fiscalYearStartMonth: 4 };
    expect(resolvePreset('this_year', april)).toEqual({ from: '2026-04-01', to: '2026-10-14' });
    expect(resolvePreset('last_quarter', april)).toEqual({ from: '2026-07-01', to: '2026-10-01' });
    expect(resolvePreset('last_month', { ...cal, today: '2026-01-15' })).toEqual({
      from: '2025-12-01',
      to: '2026-01-01',
    });
  });

  it('picks the latest whole month by name and labels periods', () => {
    expect(namedMonth(3, cal)).toEqual({ from: '2026-03-01', to: '2026-04-01' });
    expect(namedMonth(11, cal)).toEqual({ from: '2025-11-01', to: '2025-12-01' });
    expect(periodLabel({ from: '2026-09-01', to: '2026-10-01' })).toBe('September 2026');
    expect(periodLabel({ from: '2025-01-01', to: '2026-01-01' })).toBe('2025');
    expect(periodLabel({ from: '2026-10-07', to: '2026-10-14' })).toBe('7 Oct 2026 – 13 Oct 2026');
    expect(periodLabel(undefined)).toBe('all time');
  });
});
