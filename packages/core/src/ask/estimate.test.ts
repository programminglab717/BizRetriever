import { describe, expect, it } from 'vitest';

import { estimateRequestWithRules } from './estimate';
import { fixtureCatalog } from './fixtures';

// Tuesday 13 October 2026, weeks start on Monday.
const catalog = fixtureCatalog();
const planning = {
  forecasts: ['net_sales', 'order_count', 'units_sold'],
  goals: ['net_sales', 'order_count', 'gross_profit'],
};
const read = (q: string) => estimateRequestWithRules(q, catalog, planning);

describe('estimateRequestWithRules', () => {
  it.each([
    ['How much will I sell next month?', 'net_sales', '2026-11-01', '2026-12-01', 'November 2026'],
    ['What will my sales be next week?', 'net_sales', '2026-10-19', '2026-10-26', 'next week'],
    [
      'Forecast orders for the next 4 weeks',
      'order_count',
      '2026-10-13',
      '2026-11-10',
      'the next 4 weeks',
    ],
    [
      'How many items will I sell in the next 30 days',
      'units_sold',
      '2026-10-13',
      '2026-11-12',
      'the next 30 days',
    ],
    [
      'What will sales be for the rest of the month',
      'net_sales',
      '2026-10-13',
      '2026-11-01',
      'the rest of October',
    ],
    ['How much will I sell this month?', 'net_sales', '2026-10-01', '2026-11-01', 'October 2026'],
    ['How much will I sell in December?', 'net_sales', '2026-12-01', '2027-01-01', 'December 2026'],
    ['Expected revenue next month', 'net_sales', '2026-11-01', '2026-12-01', 'November 2026'],
    [
      'How many orders should I expect next week',
      'order_count',
      '2026-10-19',
      '2026-10-26',
      'next week',
    ],
    ['Predict my sales', 'net_sales', '2026-10-13', '2026-11-12', 'the next 30 days'],
    [
      'sales forecast for the coming month',
      'net_sales',
      '2026-10-13',
      '2026-11-12',
      'the next 30 days',
    ],
  ])('“%s” is an estimate', (q, metric, from, to, label) => {
    expect(read(q)).toEqual({ kind: 'forecast', metric, period: { from, to }, label });
  });

  it.each([
    ['Am I on track for my goal?', null],
    ['Will I hit my sales target this month?', 'net_sales'],
    ['How are my goals going', null],
    ['Am I going to reach my order goal?', 'order_count'],
  ])('“%s” asks about a goal', (q, metric) => {
    expect(read(q)).toEqual({ kind: 'goal', metric });
  });

  it.each([
    'What should I reorder?',
    'What do I need to order this week?',
    'Which products should I restock?',
    'reorder list',
  ])('“%s” asks what to reorder', (q) => {
    expect(read(q)).toEqual({ kind: 'reorder' });
  });

  it('says when a measure can’t be estimated', () => {
    expect(read('Will my margin go up next month?')).toEqual({
      kind: 'not_estimable',
      metric: 'gross_margin_pct',
    });
  });

  it.each([
    'How much did I sell last month?',
    'Sales by channel this month',
    'How many orders this week',
    'What did I sell in December 2025?',
    'Which products are running out?',
    'When will Sage Stoneware Mug run out?',
    'How many orders do I have',
    'Who are my best customers?',
    'Show me orders from last week',
    'What was my revenue in September?',
  ])('“%s” is about what happened, not an estimate', (q) => {
    expect(read(q)).toBeNull();
  });
});
