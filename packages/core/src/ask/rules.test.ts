import { describe, expect, it } from 'vitest';

import { fixtureCatalog as fixture } from './fixtures';
import type { Interpretation, QuestionSpec } from './interpretation';
import { questionSpecSchema } from './interpretation';
import { interpretWithRules } from './rules';

const catalog = fixture();

function ask(q: string, previous?: QuestionSpec) {
  const r = interpretWithRules(q, catalog, previous);
  if (!r) throw new Error(`no interpretation for ${q}`);
  return r;
}
function query(q: string, previous?: QuestionSpec) {
  const r = ask(q, previous);
  expect(r.confident, `${q} → leftover ${r.leftover.join(', ')}`).toBe(true);
  const i = r.interpretation;
  if (i.kind !== 'query') throw new Error(`${q} → ${i.kind}`);
  expect(questionSpecSchema.safeParse(i.spec).success).toBe(true);
  return i;
}
const spec = (q: string, previous?: QuestionSpec) => query(q, previous).spec;

describe('interpretWithRules: the pack example questions', () => {
  it('How much did I sell last month?', () => {
    const i = query('How much did I sell last month?');
    expect(i.spec).toEqual({
      metrics: ['net_sales'],
      dimensions: [],
      filters: [],
      having: [],
      timeRange: { preset: 'last_month' },
    });
    expect(i.assumptions.join(' ')).toMatch(/net sales/);
  });

  it('Which channel is growing fastest?', () => {
    const i = query('Which channel is growing fastest?');
    expect(i.spec).toMatchObject({
      metrics: ['net_sales'],
      dimensions: [{ field: 'sale.channel' }],
      timeRange: { preset: 'last_90_days' },
      compareTo: 'previous_period',
    });
    expect(i.assumptions.join(' ')).toMatch(/90 days/);
  });

  it('Show sales by week this year.', () => {
    expect(spec('Show sales by week this year.')).toMatchObject({
      metrics: ['net_sales'],
      dimensions: [{ time: 'week' }],
      timeRange: { preset: 'this_year' },
    });
  });

  it('Which products made me the most profit last month?', () => {
    const i = query('Which products made me the most profit last month?');
    expect(i.spec).toEqual({
      metrics: ['gross_profit'],
      dimensions: [{ field: 'product.name' }],
      filters: [],
      having: [],
      timeRange: { preset: 'last_month' },
      orderBy: { by: 'gross_profit', dir: 'desc' },
      limit: 10,
    });
    expect(i.assumptions.join(' ')).toMatch(/gross profit/);
  });

  it("What's not selling?", () => {
    expect(spec("What's not selling?")).toMatchObject({
      metrics: ['dead_stock_value'],
      dimensions: [{ field: 'product.name' }],
      having: [{ metric: 'dead_stock_value', op: 'gt', value: 0 }],
    });
  });

  it('Which products have the best margins?', () => {
    expect(spec('Which products have the best margins?')).toMatchObject({
      metrics: ['gross_margin_pct'],
      dimensions: [{ field: 'product.name' }],
      orderBy: { by: 'gross_margin_pct', dir: 'desc' },
      limit: 10,
    });
  });

  it("What's my best seller on Etsy?", () => {
    expect(spec("What's my best seller on Etsy?")).toMatchObject({
      metrics: ['net_sales'],
      dimensions: [{ field: 'product.name' }],
      filters: [{ field: 'sale.channel', op: 'eq', values: ['etsy'] }],
      orderBy: { by: 'net_sales', dir: 'desc' },
    });
  });

  it("What's about to run out?", () => {
    expect(spec("What's about to run out?")).toMatchObject({
      metrics: ['days_of_cover'],
      dimensions: [{ field: 'product.name' }],
      orderBy: { by: 'days_of_cover', dir: 'asc' },
      limit: 10,
    });
  });

  it('How much money is tied up in stock?', () => {
    const i = query('How much money is tied up in stock?');
    expect(i.spec).toMatchObject({ metrics: ['stock_value'], dimensions: [] });
    // A snapshot: no "this covers …" period note.
    expect(i.assumptions).toEqual([]);
  });

  it('What should I reorder this week?', () => {
    expect(spec('What should I reorder this week?')).toMatchObject({
      metrics: ['days_of_cover'],
      dimensions: [{ field: 'product.name' }],
    });
  });

  it('Who are my top customers? asks spend or orders', () => {
    const r = ask('Who are my top customers?');
    expect(r.interpretation.kind).toBe('clarify');
    if (r.interpretation.kind !== 'clarify') return;
    expect(r.interpretation.options.map((o) => o.label)).toEqual([
      'How much they spend',
      'How often they order',
    ]);
    expect(r.interpretation.options[0]!.spec).toMatchObject({
      metrics: ['net_sales'],
      dimensions: [{ field: 'customer.name' }],
      orderBy: { by: 'net_sales', dir: 'desc' },
    });
    expect(r.interpretation.options[1]!.spec.metrics).toEqual(['order_count']);
  });

  it('Which customers stopped ordering?', () => {
    expect(spec('Which customers stopped ordering?')).toMatchObject({
      metrics: ['lapsed_customers'],
      dimensions: [{ field: 'customer.name' }],
      having: [{ metric: 'lapsed_customers', op: 'gt', value: 0 }],
    });
  });

  it('How many new customers did I get this month?', () => {
    expect(spec('How many new customers did I get this month?')).toMatchObject({
      metrics: ['new_customers'],
      timeRange: { preset: 'this_month' },
    });
  });

  it('What share of customers come back?', () => {
    const i = query('What share of customers come back?');
    expect(i.spec).toMatchObject({
      metrics: ['repeat_customer_rate'],
      dimensions: [],
      timeRange: { preset: 'this_year' },
    });
    expect(i.assumptions.join(' ')).toMatch(/2026/);
  });

  it('What did I spend on ads this year?', () => {
    expect(spec('What did I spend on ads this year?')).toMatchObject({
      metrics: ['expenses_total'],
      filters: [{ field: 'expense.category', op: 'contains', values: ['advertising'] }],
      timeRange: { preset: 'this_year' },
    });
  });

  it("What's my profit after expenses this quarter?", () => {
    expect(spec("What's my profit after expenses this quarter?")).toMatchObject({
      metrics: ['net_profit_estimate'],
      timeRange: { preset: 'this_quarter' },
    });
  });

  it('Who owes me money?', () => {
    expect(spec('Who owes me money?')).toMatchObject({
      metrics: ['outstanding_receivables'],
      dimensions: [{ field: 'customer.name' }],
      having: [{ metric: 'outstanding_receivables', op: 'gt', value: 0 }],
    });
  });
});

describe('interpretWithRules: the demo script', () => {
  it('Who are my best customers? asks, as in the script', () => {
    const r = ask('Who are my best customers?');
    expect(r.interpretation.kind).toBe('clarify');
  });
});

describe('interpretWithRules: words and numbers', () => {
  it('reads top N, last N days, months and years', () => {
    expect(spec('top 5 products by revenue in the last 14 days')).toMatchObject({
      dimensions: [{ field: 'product.name' }],
      timeRange: { from: '2026-09-30', to: '2026-10-14' },
      orderBy: { by: 'net_sales', dir: 'desc' },
      limit: 5,
    });
    expect(spec('sales in March').timeRange).toEqual({ from: '2026-03-01', to: '2026-04-01' });
    expect(spec('sales in November').timeRange).toEqual({ from: '2025-11-01', to: '2025-12-01' });
    expect(spec('sales in march 2025').timeRange).toEqual({ from: '2025-03-01', to: '2025-04-01' });
    expect(spec('orders in 2025')).toMatchObject({
      metrics: ['order_count'],
      timeRange: { from: '2025-01-01', to: '2026-01-01' },
    });
  });

  it('maps the owner’s words for channels and their own category names', () => {
    expect(spec('website sales this month').filters).toEqual([
      { field: 'sale.channel', op: 'eq', values: ['online_store'] },
    ]);
    expect(spec('sales of candles last month').filters).toEqual([
      { field: 'product.category', op: 'eq', values: ['Candles'] },
    ]);
    expect(spec('etsy and amazon sales').filters).toEqual([
      { field: 'sale.channel', op: 'in', values: ['etsy', 'amazon'] },
    ]);
    expect(spec('How many Sage Stoneware Mugs did I sell?')).toMatchObject({
      metrics: ['units_sold'],
      filters: [{ field: 'product.name', op: 'eq', values: ['Sage Stoneware Mug'] }],
    });
  });

  it('breaks down by more than one thing and by time', () => {
    expect(spec('sales by channel by month').dimensions).toEqual([
      { time: 'month' },
      { field: 'sale.channel' },
    ]);
    expect(spec('profit by category and channel')).toMatchObject({
      metrics: ['gross_profit'],
      dimensions: [{ field: 'product.category' }, { field: 'sale.channel' }],
    });
  });

  it('asks for a table when told to', () => {
    expect(query('show sales by product as a table').chart).toBe('table');
  });

  it('compares with last year', () => {
    expect(spec('sales this month vs last year')).toMatchObject({
      timeRange: { preset: 'this_month' },
      compareTo: 'same_period_last_year',
    });
  });

  it('fills the default period from the pack and says so', () => {
    const i = query('how many orders');
    expect(i.spec.timeRange).toEqual({ preset: 'all_time' });
    expect(i.assumptions).toContain('This covers all your records so far.');
    expect(query('new customers').spec.timeRange).toEqual({ preset: 'this_month' });
  });
});

describe('interpretWithRules: when it should hand over', () => {
  it.each([
    'What were my best days of the week?',
    'what is my best month?',
    'why did sales drop in september?',
    'which supplier delivers the fastest?',
    'how is the weather affecting my business',
  ])('%s is not confident', (q) => {
    const r = interpretWithRules(q, catalog);
    expect(r?.confident ?? false).toBe(false);
  });

  it('returns nothing for questions with no business words', () => {
    expect(interpretWithRules('hello there', catalog)).toBeNull();
  });

  it('says why when the measure needs data that isn’t there', () => {
    const c = fixture({ gross_profit: 'Add product costs to see profit.' });
    const r = interpretWithRules('what was my profit last month', c);
    expect(r?.interpretation).toEqual<Interpretation>({
      kind: 'unanswerable',
      reason: 'missing_data',
      missing: ['Gross profit'],
      message: 'Add product costs to see profit.',
    });
  });
});

describe('interpretWithRules: follow-ups', () => {
  const previous = spec('sales by channel last month');

  it('keeps the measure and changes the period', () => {
    expect(spec('and this month?', previous)).toMatchObject({
      metrics: ['net_sales'],
      dimensions: [{ field: 'sale.channel' }],
      timeRange: { preset: 'this_month' },
    });
  });

  it('narrows to a value', () => {
    expect(spec('what about etsy', previous)).toMatchObject({
      metrics: ['net_sales'],
      filters: [{ field: 'sale.channel', op: 'eq', values: ['etsy'] }],
      timeRange: { preset: 'last_month' },
    });
  });

  it('switches the breakdown', () => {
    expect(spec('by product', previous)).toMatchObject({
      metrics: ['net_sales'],
      dimensions: [{ field: 'product.name' }],
      timeRange: { preset: 'last_month' },
    });
  });

  it('a ranking question isn’t a follow-up', () => {
    expect(ask('Who are my best customers?', previous).interpretation.kind).toBe('clarify');
  });

  it('a new full question starts fresh', () => {
    expect(spec('how many orders this year', previous)).toEqual({
      metrics: ['order_count'],
      dimensions: [],
      filters: [],
      having: [],
      timeRange: { preset: 'this_year' },
    });
  });
});
