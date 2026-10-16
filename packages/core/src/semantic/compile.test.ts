import { getPack, packMetricsFileSchema } from '@bizr/packs';
import { describe, expect, it } from 'vitest';

import { compileChangePlan } from '../change-plan/compile';
import { planFromPack } from '../change-plan/from-pack';
import { AvailabilityResolver } from './availability';
import { compileQuery } from './compile';
import { LinkGraph, SemanticError } from './graph';
import { buildModel, type CompileContext } from './model';

const pack = getPack('retail');
const { catalog } = compileChangePlan(
  't_abcdefghij',
  [],
  planFromPack(
    pack,
    pack.entities.map((e) => e.id),
  ),
);
const model = buildModel(catalog, pack);
const ctx: CompileContext = {
  timezone: 'America/New_York',
  weekStart: 1,
  fiscalYearStartMonth: 1,
  today: '2026-10-13',
};
const SEP = { from: '2026-09-01', to: '2026-10-01' };

function userError(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof SemanticError) return err.userMessage;
    throw err;
  }
  throw new Error('expected a SemanticError');
}

describe('compileQuery (golden SQL)', () => {
  it('net sales by channel for a month', () => {
    const q = compileQuery(
      model,
      {
        metrics: ['net_sales', 'order_count'],
        dimensions: [{ field: 'sale.channel' }],
        period: SEP,
      },
      ctx,
    );
    expect(q.sql).toMatchSnapshot();
    expect(q.params).toMatchSnapshot();
    expect(q.columns.map((c) => [c.key, c.label])).toEqual([
      ['d0', 'Sold through'],
      ['m_net_sales', 'Net sales'],
      ['m_order_count', 'Orders'],
    ]);
  });

  it('a per-product roll-up (dead stock)', () => {
    expect(compileQuery(model, { metrics: ['dead_stock_value'] }, ctx).sql).toMatchSnapshot();
  });

  it('monthly with a comparison-free time breakdown and a filter', () => {
    const q = compileQuery(
      model,
      {
        metrics: ['gross_profit'],
        dimensions: [{ time: 'month' }],
        filters: [{ field: 'product.category', op: 'in', value: ['Mugs & Cups', 'Candles'] }],
        period: { from: '2026-07-01', to: '2026-10-01' },
      },
      ctx,
    );
    expect(q.sql).toMatchSnapshot();
    expect(q.params).toContainEqual(['mugs & cups', 'candles']);
  });

  it('is deterministic', () => {
    const spec = { metrics: ['net_sales', 'new_customers'], period: SEP };
    expect(compileQuery(model, spec, ctx)).toEqual(compileQuery(model, spec, ctx));
  });
});

describe('compileQuery semantics', () => {
  it('compiles every retail metric, alone and by month where it has dates', () => {
    for (const m of pack.metrics.metrics) {
      expect(() => compileQuery(model, { metrics: [m.id], period: SEP }, ctx), m.id).not.toThrow();
      if (!m.snapshot)
        expect(
          () =>
            compileQuery(
              model,
              { metrics: [m.id], dimensions: [{ time: 'month' }], period: SEP },
              ctx,
            ),
          m.id,
        ).not.toThrow();
    }
  });

  it('never puts values in the SQL text', () => {
    const q = compileQuery(
      model,
      {
        metrics: ['net_sales'],
        filters: [{ field: 'product.name', op: 'eq', value: "x'; DROP TABLE sales; --" }],
        period: SEP,
      },
      ctx,
    );
    expect(q.sql).not.toContain('DROP');
    expect(q.params).toContain("x'; drop table sales; --");
  });

  it('escapes LIKE wildcards in "contains" filters', () => {
    const q = compileQuery(
      model,
      {
        metrics: ['net_sales'],
        filters: [{ field: 'product.name', op: 'contains', value: '50%_off' }],
      },
      ctx,
    );
    expect(q.params).toContain('%50\\%\\_off%');
  });

  it('explains breakdowns that don’t make sense, in plain language', () => {
    expect(
      userError(() =>
        compileQuery(
          model,
          { metrics: ['expenses_total'], dimensions: [{ field: 'sale.channel' }] },
          ctx,
        ),
      ),
    ).toBe('We can’t split expenses by sold through.');
    expect(
      userError(() =>
        compileQuery(model, { metrics: ['stock_value'], dimensions: [{ time: 'month' }] }, ctx),
      ),
    ).toMatch(/don’t have dates/);
    expect(
      userError(() =>
        compileQuery(
          model,
          {
            metrics: ['expenses_total'],
            filters: [{ field: 'product.category', op: 'eq', value: 'x' }],
          },
          ctx,
        ),
      ),
    ).toMatch(/can’t narrow expenses down/);
    expect(userError(() => compileQuery(model, { metrics: ['nope'] }, ctx))).toMatch(/nope/);
  });

  it('compares a breakdown with the period before', () => {
    const q = compileQuery(
      model,
      {
        metrics: ['net_sales'],
        dimensions: [{ field: 'sale.channel' }],
        period: SEP,
        compare: 'previous_period',
      },
      ctx,
    );
    expect(q.sql).not.toContain('FULL JOIN');
    expect(q.sql).toMatchSnapshot();
  });

  it('compares calendar months with the month before, other ranges with the same length', () => {
    expect(
      compileQuery(
        model,
        { metrics: ['order_count'], period: SEP, compare: 'previous_period' },
        ctx,
      ).previousPeriod,
    ).toEqual({ from: '2026-08-01', to: '2026-09-01' });
    expect(
      compileQuery(
        model,
        {
          metrics: ['order_count'],
          period: { from: '2026-09-10', to: '2026-09-17' },
          compare: 'previous_period',
        },
        ctx,
      ).previousPeriod,
    ).toEqual({ from: '2026-09-03', to: '2026-09-10' });
    expect(
      compileQuery(model, { metrics: ['order_count'], period: SEP, compare: 'previous_year' }, ctx)
        .previousPeriod,
    ).toEqual({ from: '2025-09-01', to: '2025-10-01' });
  });

  it('buckets weeks and fiscal years by the workspace settings', () => {
    const sunday = compileQuery(
      model,
      { metrics: ['order_count'], dimensions: [{ time: 'week' }] },
      { ...ctx, weekStart: 7 },
    ).sql;
    expect(sunday).toContain(`interval '1 days'`);
    const april = compileQuery(
      model,
      { metrics: ['order_count'], dimensions: [{ time: 'year' }] },
      { ...ctx, fiscalYearStartMonth: 4 },
    ).sql;
    expect(april).toContain(`interval '3 months'`);
  });
});

describe('availability', () => {
  const present = (drop: string[]) => {
    const all = new Set(catalog.flatMap((e) => e.fields.map((f) => `${e.key}.${f.key}`)));
    for (const d of drop) all.delete(d);
    return all;
  };

  it('drops optional parts and keeps the metric', () => {
    const m = buildModel(catalog, pack, present(['return.refund_amount', 'return.quantity']));
    const r = new AvailabilityResolver(m);
    expect(r.metric('net_sales').available).toBe(true);
    expect(r.metric('refunds')).toMatchObject({ available: false, reason: /returns/ });
    expect(JSON.stringify((r.metric('net_sales') as { ir: unknown }).ir)).not.toContain('refund');
  });

  it('needs at least one discount detail for discounts', () => {
    const m = buildModel(catalog, pack, present(['sale_line.discount', 'sale.discount_total']));
    expect(new AvailabilityResolver(m).metric('discounts').available).toBe(false);
    const one = buildModel(catalog, pack, present(['sale_line.discount']));
    expect(new AvailabilityResolver(one).metric('discounts').available).toBe(true);
  });

  it('builds a reason from labels when the pack has no hint', () => {
    const file = packMetricsFileSchema.parse({
      metrics: [
        {
          id: 'x',
          label: 'Brand total',
          description: 'x',
          format: 'money',
          ir: { sum: { field: 'product.brand' } },
        },
      ],
    });
    const m = buildModel(catalog, { metrics: file }, present(['product.brand']));
    expect(new AvailabilityResolver(m).metric('x')).toMatchObject({
      available: false,
      reason: 'Add the brand of your products to see brand total.',
    });
  });
});

describe('LinkGraph', () => {
  it('finds the shortest link path and the date of record types without one', () => {
    const g = new LinkGraph(catalog);
    expect(g.path('sale_line', 'customer')?.map((h) => h.field)).toEqual(['sale', 'customer']);
    expect(g.path('expense', 'sale')).toBeNull();
    expect(g.timeField('sale_line')).toEqual({ entity: 'sale', field: 'sale_date' });
    expect(g.timeField('product')).toBeUndefined();
  });

  it('refuses ambiguous paths unless the pack prefers one', () => {
    const twoWays = catalog.map((e) =>
      e.key === 'return'
        ? {
            ...e,
            fields: [
              ...e.fields,
              {
                key: 'buyer',
                label: 'Buyer',
                type: 'reference' as const,
                references: 'customer',
                required: false,
                pii: false,
              },
              {
                key: 'payer',
                label: 'Payer',
                type: 'reference' as const,
                references: 'customer',
                required: false,
                pii: false,
              },
            ],
          }
        : e,
    );
    expect(() => new LinkGraph(twoWays).path('return', 'customer')).toThrow(SemanticError);
    const preferred = new LinkGraph(twoWays, [
      { from: 'return', to: 'customer', via: ['return.buyer'] },
    ]);
    expect(preferred.path('return', 'customer')?.map((h) => h.field)).toEqual(['buyer']);
  });
});
