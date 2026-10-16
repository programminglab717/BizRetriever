import { describe, expect, it } from 'vitest';

import { checkMetrics, packMetricsFileSchema } from './metrics';
import { getPack } from './registry';

const pack = getPack('retail');

describe('retail metrics', () => {
  it('defines every metric in VERTICAL_PACKS §2.5', () => {
    const ids = pack.metrics.metrics.map((m) => m.id);
    expect(ids).toHaveLength(28);
    for (const id of [
      'net_sales',
      'gross_profit',
      'days_of_cover',
      'dead_stock_value',
      'lapsed_customers',
      'overdue_receivables',
    ])
      expect(ids).toContain(id);
  });

  it('passes the cross-checks', () => {
    expect(checkMetrics(pack.entities, pack.metrics)).toEqual([]);
  });
});

describe('checkMetrics', () => {
  const file = (metrics: unknown[], extra: Record<string, unknown> = {}) =>
    packMetricsFileSchema.parse({ metrics, ...extra });

  it('reports unknown fields, metrics, filters and expressions', () => {
    const problems = checkMetrics(
      pack.entities,
      file([
        {
          id: 'a',
          label: 'A',
          description: 'A',
          format: 'money',
          ir: { sub: [{ sum: { field: 'sale_line.nope' }, where: ['missing'] }, { ref: 'ghost' }] },
        },
        { id: 'b', label: 'B', description: 'B', format: 'money', ir: { sum: { expr: 'none' } } },
      ]),
    ).join('\n');
    expect(problems).toContain('unknown field "sale_line.nope"');
    expect(problems).toContain('unknown filter "missing"');
    expect(problems).toContain('unknown metric "ghost"');
    expect(problems).toContain('unknown expression "none"');
  });

  it('rejects metrics that depend on themselves', () => {
    const problems = checkMetrics(
      pack.entities,
      file([
        {
          id: 'a',
          label: 'A',
          description: 'A',
          format: 'money',
          ir: { add: [{ ref: 'b' }, { const: 1 }] },
        },
        {
          id: 'b',
          label: 'B',
          description: 'B',
          format: 'money',
          ir: { add: [{ ref: 'a' }, { const: 1 }] },
        },
      ]),
    );
    expect(problems).toContain('metric "a" depends on itself');
  });

  it('rejects links as dimensions and SQL-looking text as ids', () => {
    expect(
      checkMetrics(
        pack.entities,
        file([{ id: 'a', label: 'A', description: 'A', format: 'money', ir: { const: 1 } }], {
          dimensions: [{ field: 'sale.customer', label: 'Customer' }],
        }),
      ),
    ).toContain('dimension "sale.customer" must not be a link');
    expect(() =>
      file([
        { id: 'a; drop table x', label: 'A', description: 'A', format: 'money', ir: { const: 1 } },
      ]),
    ).toThrow();
  });
});
