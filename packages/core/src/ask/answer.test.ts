import { AiUnavailableError } from '@bizr/ai';
import { describe, expect, it } from 'vitest';

import { renderTemplate, segmentsToText } from '../narration';
import type { ResultColumn } from '../semantic/compile';
import {
  answerFacts,
  chooseChart,
  explainSpec,
  templateAnswer,
  timeLabel,
  toAnswerData,
  type FactContext,
} from './answer';
import { decimalCompare, decimalSub } from './decimal';
import { FakeProvider, fixtureCatalog } from './fixtures';
import type { QuestionSpec } from './interpretation';
import { explainFallbackSql, narrate, narrationProblems } from './narrate';

const catalog = fixtureCatalog();
const fmt = { locale: 'en-GB', currency: 'GBP' };
const SEP = { from: '2026-09-01', to: '2026-10-01' };
const AUG = { from: '2026-08-01', to: '2026-09-01' };

const money = (id: string, label: string, prev = false): ResultColumn[] => [
  { key: `m_${id}`, kind: 'metric', label, format: 'money', metric: id },
  ...(prev
    ? [
        {
          key: `m_${id}__prev`,
          kind: 'previous' as const,
          label: `${label} (before)`,
          format: 'money' as const,
          metric: id,
        },
      ]
    : []),
];
const spec = (over: Partial<QuestionSpec> = {}): QuestionSpec => ({
  metrics: ['net_sales'],
  dimensions: [],
  filters: [],
  having: [],
  timeRange: { preset: 'last_month' },
  ...over,
});
const ctx = (s: QuestionSpec, extra: Partial<FactContext> = {}): FactContext => ({
  catalog,
  spec: s,
  period: SEP,
  ...extra,
});
function say(
  columns: ResultColumn[],
  rows: Record<string, unknown>[],
  s: QuestionSpec,
  extra: Partial<FactContext> = {},
) {
  const data = toAnswerData({ columns, rows, truncated: false });
  const c = ctx(s, extra);
  const facts = answerFacts(data, c);
  const template = templateAnswer(data, facts, c);
  expect(narrationProblems(template, Object.keys(facts.facts))).toEqual([]);
  return { data, facts, text: segmentsToText(renderTemplate(template, facts.facts, fmt)) };
}

describe('decimal helpers', () => {
  it('subtracts and compares exactly', () => {
    expect(decimalSub('1000.10', '999.9')).toBe('0.2');
    expect(decimalSub('0.1', '0.3')).toBe('-0.2');
    expect(decimalSub('5', '5.0000')).toBe('0');
    expect(decimalCompare('10.5', '10.50')).toBe(0);
    expect(decimalCompare('-1', '0')).toBe(-1);
  });
});

describe('answers', () => {
  it('a total with a comparison', () => {
    const { text, facts } = say(
      money('net_sales', 'Net sales', true),
      [{ m_net_sales: '12500.5000', m_net_sales__prev: '10000.0000' }],
      spec({ compareTo: 'previous_period' }),
      { previousPeriod: AUG },
    );
    expect(text).toBe(
      'Your net sales in September 2026 was £12,500.50. That’s up 25% on August 2026.',
    );
    expect(facts.facts.net_sales_change).toEqual({ kind: 'money', value: '2500.5' });
  });

  it('a ranked list, with names and money from the data', () => {
    const { text, data } = say(
      [
        { key: 'd0', kind: 'dimension', label: 'Product', dimension: { field: 'product.name' } },
        ...money('gross_profit', 'Gross profit'),
      ],
      [
        { d0: 'Sage Stoneware Mug', m_gross_profit: '812.0000', __total: '48' },
        { d0: 'Linen Napkin Set', m_gross_profit: '640.2500', __total: '48' },
      ],
      spec({
        metrics: ['gross_profit'],
        dimensions: [{ field: 'product.name' }],
        orderBy: { by: 'gross_profit', dir: 'desc' },
        limit: 2,
      }),
    );
    expect(data.totalRows).toBe(48);
    expect(text).toBe(
      'Sage Stoneware Mug had the highest gross profit in September 2026, with £812.00. Next is Linen Napkin Set with £640.25. Showing the top 2 of 48 products.',
    );
  });

  it('doesn’t name a blank breakdown as the top one', () => {
    const { text } = say(
      [
        { key: 'd0', kind: 'dimension', label: 'Customer', dimension: { field: 'customer.name' } },
        ...money('net_sales', 'Net sales'),
      ],
      [
        { d0: null, m_net_sales: '900' },
        { d0: 'Bloom & Co', m_net_sales: '500' },
      ],
      spec({ dimensions: [{ field: 'customer.name' }] }),
    );
    expect(text).toMatch(/^Bloom & Co had the highest net sales/);
  });

  it('shows channel names, not codes', () => {
    const { text } = say(
      [
        {
          key: 'd0',
          kind: 'dimension',
          label: 'Sold through',
          dimension: { field: 'sale.channel' },
        },
        ...money('net_sales', 'Net sales'),
      ],
      [{ d0: 'online_store', m_net_sales: '100' }],
      spec({ dimensions: [{ field: 'sale.channel' }] }),
    );
    expect(text).toContain('Website had the highest net sales');
  });

  it('over time: latest and highest', () => {
    const { text } = say(
      [
        { key: 'd0', kind: 'dimension', label: 'Month', dimension: { time: 'month' } },
        ...money('net_sales', 'Net sales'),
      ],
      [
        { d0: new Date(2026, 6, 1), m_net_sales: '900' },
        { d0: new Date(2026, 7, 1), m_net_sales: '1500' },
        { d0: new Date(2026, 8, 1), m_net_sales: '1200' },
      ],
      spec({ dimensions: [{ time: 'month' }], timeRange: { preset: 'this_year' } }),
      { period: { from: '2026-01-01', to: '2026-10-14' } },
    );
    expect(text).toBe(
      'In Sep 2026, net sales was £1,200.00. The highest was Aug 2026, with £1,500.00.',
    );
  });

  it('nothing found', () => {
    const { text } = say(
      [
        { key: 'd0', kind: 'dimension', label: 'Product', dimension: { field: 'product.name' } },
        ...money('net_sales', 'Net sales'),
      ],
      [],
      spec({ dimensions: [{ field: 'product.name' }] }),
    );
    expect(text).toBe('I didn’t find any records for this in September 2026.');
  });

  it('labels time buckets', () => {
    const cal = { fiscalYearStartMonth: 1 };
    expect(timeLabel('week', '2026-10-12', cal)).toBe('Week of 12 Oct 2026');
    expect(timeLabel('quarter', '2026-11-01', cal)).toBe('Nov–Jan 2027');
    expect(timeLabel('year', '2026-04-01', { fiscalYearStartMonth: 4 })).toBe(
      'Apr 2026 – Mar 2027',
    );
  });
});

describe('explainSpec', () => {
  it('writes the steps from the spec', () => {
    const s = spec({
      metrics: ['gross_profit'],
      dimensions: [{ field: 'product.name' }],
      filters: [{ field: 'sale.channel', op: 'eq', values: ['etsy'] }],
      orderBy: { by: 'gross_profit', dir: 'desc' },
      limit: 10,
    });
    const steps = explainSpec(s, {
      ...ctx(s),
      metrics: catalog.metrics,
      assumptions: ['I took “profit” to mean gross profit.'],
    });
    expect(steps).toEqual([
      'Gross profit: Net sales − cost of goods sold.',
      'Covers September 2026.',
      'Split by product.',
      'Only where sold through is Etsy.',
      'Sorted by gross profit, highest first; the top 10 shown.',
      'I took “profit” to mean gross profit.',
    ]);
  });
});

describe('chooseChart', () => {
  const cols = (dims: ResultColumn[], n = 1) => [
    ...dims,
    ...Array.from({ length: n }, (_, i) => money(`m${i}`, `M${i}`)[0]!),
  ];
  const data = (columns: ResultColumn[], rows: Record<string, unknown>[]) =>
    toAnswerData({ columns, rows, truncated: false });
  const time: ResultColumn = {
    key: 'd0',
    kind: 'dimension',
    label: 'Month',
    dimension: { time: 'month' },
  };
  const product: ResultColumn = {
    key: 'd0',
    kind: 'dimension',
    label: 'Product',
    dimension: { field: 'product.name' },
  };
  const channel: ResultColumn = {
    key: 'd1',
    kind: 'dimension',
    label: 'Channel',
    dimension: { field: 'sale.channel' },
  };
  const rows = (n: number, f: (i: number) => Record<string, unknown>) =>
    Array.from({ length: n }, (_, i) => f(i));

  it('picks by shape', () => {
    expect(chooseChart(data(cols([]), [{ m_m0: '1' }]), spec())).toBe('kpi');
    expect(
      chooseChart(
        data(
          cols([time]),
          rows(12, (i) => ({ d0: `2026-${i + 1}-01`, m_m0: '1' })),
        ),
        spec(),
      ),
    ).toBe('line');
    expect(
      chooseChart(
        data(
          cols([time]),
          rows(4, (i) => ({ d0: `2026-0${i + 1}-01`, m_m0: '1' })),
        ),
        spec(),
      ),
    ).toBe('bar');
    expect(
      chooseChart(
        data(
          cols([product]),
          rows(8, (i) => ({ d0: `p${i}`, m_m0: '1' })),
        ),
        spec(),
      ),
    ).toBe('bar_horizontal');
    expect(
      chooseChart(
        data(
          cols([product]),
          rows(30, (i) => ({ d0: `p${i}`, m_m0: '1' })),
        ),
        spec(),
      ),
    ).toBe('table');
    const tc = { ...channel, key: 'd1' };
    expect(
      chooseChart(
        data(
          cols([time, tc]),
          rows(8, (i) => ({ d0: '2026-01-01', d1: `c${i % 3}`, m_m0: '1' })),
        ),
        spec(),
      ),
    ).toBe('stacked_bar');
    expect(
      chooseChart(
        data(
          cols([product]),
          rows(3, (i) => ({ d0: `p${i}`, m_m0: '1' })),
        ),
        spec({ having: [{ metric: 'm0', op: 'gt', value: 0 }] }),
      ),
    ).toBe('table');
  });

  it('honours a preference only when it fits', () => {
    const d = data(
      cols([product]),
      rows(5, (i) => ({ d0: `p${i}`, m_m0: '1' })),
    );
    expect(chooseChart(d, spec(), 'table')).toBe('table');
    expect(chooseChart(d, spec(), 'line')).toBe('bar_horizontal');
  });
});

describe('narrate (Task E)', () => {
  const columns = money('net_sales', 'Net sales');
  const data = toAnswerData({ columns, rows: [{ m_net_sales: '100' }], truncated: false });
  const facts = answerFacts(data, ctx(spec()));
  const fallback = templateAnswer(data, facts, ctx(spec()));
  const base = {
    question: 'how much did I sell last month',
    data,
    facts,
    fallback,
    assumptions: [],
  };

  it('uses the AI’s template when it passes the checks', async () => {
    const provider = new FakeProvider({
      narrate_answer: [{ text: 'You took {{net_sales}} in {{period}}.' }],
    });
    const out = await narrate({ ...base, provider });
    expect(out).toEqual({
      template: 'You took {{net_sales}} in {{period}}.',
      origin: 'ai',
      aiCalls: 1,
    });
    expect(provider.calls[0]!.messages[0]!.content).not.toContain('100');
  });

  it('retries once, then falls back to code’s wording', async () => {
    const provider = new FakeProvider({
      narrate_answer: [
        { text: 'You took £100 last month.' },
        { text: 'Sales were {{net_sales}} because of the holidays.' },
      ],
    });
    const out = await narrate({ ...base, provider });
    expect(out).toEqual({ template: fallback, origin: 'template', aiCalls: 2 });
    expect(provider.calls[1]!.messages.at(-1)!.content).toContain('number outside a placeholder');
  });

  it('works without the AI', async () => {
    const provider = new FakeProvider({
      narrate_answer: [new AiUnavailableError('no key', 'AI off')],
    });
    expect((await narrate({ ...base, provider })).origin).toBe('template');
    expect((await narrate({ ...base, provider: null })).origin).toBe('template');
  });

  it('checks the rules on the text', () => {
    expect(narrationProblems('Up {{x}}. Down. Again. More.', ['x'])).toContain(
      'use at most three sentences',
    );
    expect(narrationProblems('**Wow** {{x}}', ['x'])).toContain('no markdown');
    expect(narrationProblems('{{x}} so you should restock', ['x']).length).toBeGreaterThan(0);
  });
});

describe('explainFallbackSql (Task F)', () => {
  const records = { sales: 'sales', products: 'products' };
  it('uses checked AI steps, or plain generic ones', async () => {
    const good = new FakeProvider({
      explain_sql: [
        { steps: ['Took every completed sale.', 'Grouped them by the day of the week.'] },
      ],
    });
    expect(
      await explainFallbackSql({ sql: 'SELECT 1 FROM sales', records, provider: good }),
    ).toEqual({
      origin: 'ai',
      steps: ['Took every completed sale.', 'Grouped them by the day of the week.'],
    });
    const bad = new FakeProvider({
      explain_sql: [{ steps: ['Ran SELECT on the sales table.', 'Took 7 days.'] }],
    });
    const out = await explainFallbackSql({ sql: 'SELECT 1 FROM sales', records, provider: bad });
    expect(out.origin).toBe('template');
    expect(out.steps[1]).toBe('It reads your sales.');
  });
});
