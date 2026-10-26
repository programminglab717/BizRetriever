import { describe, expect, it } from 'vitest';

import type { GoalProgress } from './goals';
import { formatEstimate, goalLines, noteText, roundEstimate } from './text';

const o = { locale: 'en-US', currency: 'USD' };

describe('estimate wording', () => {
  it('rounds estimates to three figures and never shows cents', () => {
    expect(roundEstimate(11_437.8)).toBe(11_400);
    expect(roundEstimate(987.4)).toBe(987);
    expect(roundEstimate(42.6)).toBe(43);
    expect(roundEstimate(-5)).toBe(0);
    expect(formatEstimate(11_437.8, 'money', o)).toBe('$11,400');
    expect(formatEstimate(1234, 'number', o)).toBe('1,230');
  });

  it('says what each estimate assumed, in plain words', () => {
    expect(noteText({ kind: 'season', month: 11, change: 0.43 }, 'en-US')).toBe(
      'November is usually 43% busier than your last 4 weeks.',
    );
    expect(noteText({ kind: 'growth', yearly: -0.12 }, 'en-US')).toMatch(/12% down/);
    expect(noteText({ kind: 'no_season', historyDays: 90 }, 'en-US')).toMatch(/90 days of sales/);
    expect(noteText({ kind: 'weekdays', busiest: 5, change: 0.45 }, 'en-US')).toBe(
      'Saturdays are your busiest day (45% above an average day).',
    );
  });

  it('writes goal progress with exact recorded numbers and rounded estimates', () => {
    const g: GoalProgress = {
      metric: { id: 'net_sales', label: 'Net sales', format: 'money' },
      target: '12000',
      month: { from: '2026-10-01', to: '2026-11-01', label: 'October 2026' },
      soFar: '8210.5000',
      share: 0.6842,
      projected: { total: 11_437, low: 10_612, high: 12_262 },
      status: 'behind',
      perDayNeeded: 421.06,
      daysLeft: 9,
      notes: [],
    };
    expect(goalLines(g, o)).toEqual({
      soFar: 'October 2026 so far: $8,210.50 of $12,000.00 (68%).',
      heading:
        'Heading for about $11,400 by the end of the month (likely between $10,600 and $12,300).',
      need: 'To reach it: about $421 a day for the last 9 days.',
    });
  });
});
