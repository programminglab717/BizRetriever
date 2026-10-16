import { getPack, type PackInsightRule } from '@bizr/packs';
import { describe, expect, it } from 'vitest';

import { effectiveThresholds, evaluateRule, severityScore, type Row } from './evaluate';
import { insightText, renderInsight } from './render';

const pack = getPack('retail');
const rule = (id: string): PackInsightRule => pack.insights.rules.find((r) => r.id === id)!;
const run = (id: string, results: Record<string, Row[]>, saved?: Record<string, number>) =>
  evaluateRule({
    rule: rule(id),
    thresholds: effectiveThresholds(rule(id), saved),
    results,
    valueLabels: { 'sale.channel': { etsy: 'Etsy', in_store: 'In person' } },
  });
const o = { locale: 'en-US', currency: 'USD' };
const text = (id: string, facts: Parameters<typeof renderInsight>[1]) =>
  insightText(renderInsight(rule(id).template, facts, o));

describe('insight rules', () => {
  it('flags products about to run out, urgent under a week, with a reorder suggestion', () => {
    const c = run('stockout_risk', {
      cover: [
        {
          d0: 'Sage Mug',
          d1: 'Clayworks',
          d2: 21,
          m_days_of_cover: '6.03',
          m_daily_sales_rate: '4.1428',
          m_stock_on_hand: '25',
        },
        {
          d0: 'Vase',
          d1: null,
          d2: null,
          m_days_of_cover: '10',
          m_daily_sales_rate: '1',
          m_stock_on_hand: '10',
        },
        {
          d0: 'Plate',
          d1: 'X',
          d2: 7,
          m_days_of_cover: '30',
          m_daily_sales_rate: '1',
          m_stock_on_hand: '30',
        },
        {
          d0: null,
          d1: null,
          d2: null,
          m_days_of_cover: '1',
          m_daily_sales_rate: '5',
          m_stock_on_hand: '5',
        },
      ],
      price: [{ d0: 'Sage Mug', m_net_sales: '1800.00', m_units_sold: '100' }],
    });
    expect(c.map((x) => [x.key, x.level])).toEqual([
      ['Sage Mug', 'urgent'],
      ['Vase', 'warn'],
    ]);
    const mug = c[0]!;
    expect(mug.fingerprint).toBe('stockout_risk|sage mug');
    expect(mug.search).toBe('Sage Mug');
    // 4.1428 a day × (21 + 30) days − 25 on hand ≈ 186.
    expect(Math.round((mug.facts.qty as { value: number }).value)).toBe(186);
    expect(mug.facts.supplier).toEqual({ format: 'text', value: 'Clayworks' });
    expect(c[1]!.facts.supplier).toEqual({ format: 'text', value: 'your supplier' });
    expect(mug.impact).toBeCloseTo(4.1428 * 14 * 18, 6);
    expect(text('stockout_risk', mug.facts)).toBe(
      'Sage Mug will run out in about 6 days at the current sales rate (4.1 a day). You have 25 left.',
    );
    const segs = renderInsight(rule('stockout_risk').template, mug.facts, o);
    expect(segs[0]).toEqual({ text: 'Sage Mug', bold: true, fact: 'product' });
    // The owner's thresholds apply, clamped to the allowed range.
    expect(run('stockout_risk', { cover: [], price: [] }, { warn_days: 5000 })).toEqual([]);
    expect(effectiveThresholds(rule('stockout_risk'), { warn_days: 5000 }).warn_days).toBe(90);
  });

  it('sums dead stock exactly and names the biggest', () => {
    const [c, ...rest] = run('dead_stock', {
      dead: [
        { d0: 'Candle', m_dead_stock_value: '1820.10', m_stock_on_hand: '140' },
        { d0: 'Wreath', m_dead_stock_value: '887.00', m_stock_on_hand: '40' },
        { d0: null, m_dead_stock_value: '5.00', m_stock_on_hand: '1' },
      ],
    });
    expect(rest).toEqual([]);
    expect(c!.facts.value).toEqual({ format: 'money', value: 2707.1, exact: '2707.10' });
    expect(c!.fingerprint).toBe('dead_stock|');
    expect(text('dead_stock', c!.facts)).toBe(
      "2 products haven't sold in 90 days. They're holding $2,707.10 of your money, led by Candle.",
    );
    expect(run('dead_stock', { dead: [{ d0: 'Pin', m_dead_stock_value: '40.00' }] })).toEqual([]);
  });

  it('spots a regular customer buying less', () => {
    const [c, ...rest] = run('customer_slipping', {
      before: [
        { d0: 'Bloom & Co', m_net_sales: '5925.00', m_order_count: '6' },
        { d0: 'Steady', m_net_sales: '3000.00', m_order_count: '6' },
        { d0: 'Once', m_net_sales: '900.00', m_order_count: '1' },
      ],
      recent: [
        { d0: 'Bloom & Co', m_net_sales: '663.00' },
        { d0: 'Steady', m_net_sales: '1000.00' },
      ],
      last: [{ d0: 'Bloom & Co', m_days_since_last_order: '41' }],
    });
    expect(rest).toEqual([]);
    expect(text('customer_slipping', c!.facts)).toBe(
      "Bloom & Co's orders dropped 66.4% compared with their usual. Their last order was 41 days ago.",
    );
  });

  it('compares the latest supplier cost with the one before it changed', () => {
    const costs = (name: string, list: [string, string][]) =>
      list.map(([date, cost]) => ({
        d0: name,
        d1: date,
        d2: '20.0000',
        m_purchase_unit_cost: cost,
      }));
    const [c, ...rest] = run('margin_squeeze', {
      costs: [
        ...costs('Napkin', [
          ['2026-07-01', '10.25'],
          ['2026-01-01', '8.40'],
          ['2026-06-09', '10.25'],
          ['2025-12-01', '8.40'],
        ]),
        ...costs('Mug', [
          ['2026-01-01', '6.00'],
          ['2026-07-01', '6.00'],
        ]),
      ],
      sold: [{ d0: 'Napkin', m_units_sold: '100' }],
    });
    expect(rest).toEqual([]);
    expect(text('margin_squeeze', c!.facts)).toBe(
      'The cost of Napkin went up 22%, from $8.40 to $10.25. At your price of $20.00, your margin fell from 58% to 48.8%.',
    );
    expect(c!.impact).toBeCloseTo(185, 6);
  });

  it('names the top return reason and the share of a channel with its label', () => {
    const [r] = run('return_spike', {
      ret: [{ d0: 'Carafe', m_return_rate: '0.2173', m_units_returned: '10' }],
      reasons: [
        { d0: 'Carafe', d1: 'Changed mind', m_units_returned: '1' },
        { d0: 'Carafe', d1: 'Arrived broken', m_units_returned: '9' },
      ],
      value: [{ d0: 'Carafe', m_net_sales: '1000', m_units_sold: '40' }],
    });
    expect(r!.level).toBe('warn');
    expect(r!.facts.top_reason).toEqual({ format: 'text', value: 'Arrived broken' });
    const [ch, ...rest] = run('channel_shift', {
      ch: [
        { d0: 'etsy', m_net_sales: '236', m_net_sales__prev: '115' },
        { d0: 'in_store', m_net_sales: '764', m_net_sales__prev: '885' },
      ],
    });
    expect(rest).toEqual([]);
    expect(text('channel_shift', ch!.facts)).toBe(
      'Etsy now brings in 23.6% of your sales, up from 11.5%.',
    );
  });

  it('keeps the direction of a weekly change in its identity', () => {
    const [down] = run('sales_change', {
      week: [{ m_net_sales: '600', m_net_sales__prev: '1000' }],
    });
    expect(down!.fingerprint).toBe('sales_change||down');
    expect(down!.level).toBe('warn');
    const [up] = run('sales_change', {
      week: [{ m_net_sales: '1300', m_net_sales__prev: '1000' }],
    });
    expect(up!.fingerprint).toBe('sales_change||up');
    expect(up!.level).toBe('info');
    expect(
      run('sales_change', { week: [{ m_net_sales: '1100', m_net_sales__prev: '1000' }] }),
    ).toEqual([]);
  });

  it('calls overdue money urgent only when a payment is two months late', () => {
    const owed = (days: string) => ({
      owed: [
        { d0: 'North Star', m_overdue_receivables: '1098.00', m_days_overdue: days },
        { d0: 'Harbor', m_overdue_receivables: '372.00', m_days_overdue: '30' },
      ],
    });
    const [c] = run('overdue_payments', owed('50'));
    expect(c!.level).toBe('warn');
    expect(c!.facts.amount).toEqual({ format: 'money', value: 1470, exact: '1470.00' });
    expect(text('overdue_payments', c!.facts)).toBe(
      "2 customers owe you $1,470.00 that's overdue. The largest is North Star ($1,098.00, 50 days late).",
    );
    expect(run('overdue_payments', owed('61'))[0]!.level).toBe('urgent');
  });

  it('orders by urgency first, then money at stake', () => {
    expect(severityScore('urgent', 0)).toBeGreaterThan(severityScore('warn', 1_000_000));
    expect(severityScore('warn', 1000)).toBeGreaterThan(severityScore('warn', 100));
    expect(severityScore('info', -5)).toBe(1);
  });
});
