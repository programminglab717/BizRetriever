import { detectRegions, type Cell, type RawSheet } from '@bizr/ingest';
import { getPack } from '@bizr/packs';
import { describe, expect, it } from 'vitest';

import { planFromPack } from '../change-plan/from-pack';
import { materialize, type EntitySpec, type SourceTable } from './materialize';
import type { ModelProposal } from './proposal';

function table(sourceId: string, name: string, rows: Cell[][]): SourceTable {
  const width = Math.max(...rows.map((r) => r.length));
  const sheet: RawSheet = {
    name,
    rows: rows.map((r) => [...r, ...Array<Cell>(width - r.length).fill(null)]),
    width,
    merges: [],
  };
  return { sourceId, fileName: `${name}.xlsx`, sheet, region: detectRegions(sheet, 0)[0]! };
}

const specs: EntitySpec[] = planFromPack(getPack('retail'), ['sale_line', 'return']).ops.flatMap(
  (o) =>
    o.op === 'create_entity'
      ? [{ key: o.key, label: o.label, fields: o.fields, naturalKeys: o.naturalKeys }]
      : [],
);

const orders = table('f0:0:0', 'Website', [
  ['Name', 'Email', 'Created at', 'Qty', 'Item', 'Price', 'Billing Name'],
  ['#1001', 'ann@x.com', '2026-03-01', 1, 'Sage Mug', '$18.00', 'Ann Lee'],
  ['#1001', null, null, 2, 'Oat Mug', '$18.00', null],
  ['#1002', 'bob@x.com', '2026-03-02', 1, 'Sage Mug', '$18.00', 'Bob Day'],
  ['#1003', 'ann@x.com', 'not a date', 1, 'Vase', '$15.00', 'Ann Lee'],
]);
const stock = table('f1:0:0', 'Stock', [
  ['SKU', 'Product', 'RRP'],
  ['M1', 'Sage Mug', 18],
  ['M2', 'Oat Mug', 18],
]);

const proposal: ModelProposal = {
  sources: [
    {
      sourceId: 'f0:0:0',
      decision: 'map',
      rowRules: [{ rule: 'fill_down', columns: [1, 2, 6], withinGroup: 0 }],
      targets: [
        {
          entity: 'sale',
          grain: 'group',
          groupBy: [0],
          fields: [
            {
              field: 'order_number',
              source: { kind: 'column', column: 0 },
              rules: [],
              confidence: 1,
            },
            { field: 'sale_date', source: { kind: 'column', column: 2 }, rules: [], confidence: 1 },
            {
              field: 'customer',
              source: { kind: 'column', column: 1 },
              rules: [],
              matchOn: ['email'],
              confidence: 1,
            },
            {
              field: 'channel',
              source: { kind: 'constant', value: 'online_store' },
              rules: [],
              confidence: 1,
            },
          ],
        },
        {
          entity: 'sale_line',
          grain: 'row',
          fields: [
            { field: 'sale', source: { kind: 'column', column: 0 }, rules: [], confidence: 1 },
            {
              field: 'line_number',
              source: { kind: 'sequence', within: 0 },
              rules: [],
              confidence: 1,
            },
            {
              field: 'product',
              source: { kind: 'column', column: 4 },
              rules: [],
              matchOn: ['name'],
              confidence: 1,
            },
            { field: 'quantity', source: { kind: 'column', column: 3 }, rules: [], confidence: 1 },
            {
              field: 'unit_price',
              source: { kind: 'column', column: 5 },
              rules: [],
              confidence: 1,
            },
            {
              field: 'line_total',
              source: {
                kind: 'derive',
                expr: { op: 'mul', args: [{ field: 'quantity' }, { field: 'unit_price' }] },
              },
              rules: [],
              confidence: 1,
            },
          ],
        },
        {
          entity: 'customer',
          grain: 'group',
          groupBy: [1],
          fields: [
            { field: 'email', source: { kind: 'column', column: 1 }, rules: [], confidence: 1 },
            { field: 'name', source: { kind: 'column', column: 6 }, rules: [], confidence: 1 },
          ],
        },
      ],
    },
    {
      sourceId: 'f1:0:0',
      decision: 'map',
      rowRules: [],
      targets: [
        {
          entity: 'product',
          grain: 'row',
          fields: [
            { field: 'sku', source: { kind: 'column', column: 0 }, rules: [], confidence: 1 },
            { field: 'name', source: { kind: 'column', column: 1 }, rules: [], confidence: 1 },
            {
              field: 'unit_price',
              source: { kind: 'column', column: 2 },
              rules: [],
              confidence: 1,
            },
          ],
        },
      ],
    },
  ],
  dedupe: [],
  assumptions: [],
  questions: [],
};

describe('materialize', () => {
  const result = materialize([orders, stock], proposal, specs, { dateOrder: 'MDY' });

  it('builds orders from item rows and keeps every line', () => {
    const sales = result.entities.get('sale')!;
    expect(sales.map((s) => s.fields.order_number)).toEqual(['#1001', '#1002']);
    expect(sales[0]!.fields.sale_date).toEqual({ kind: 'date', date: '2026-03-01' });
    const lines = result.entities.get('sale_line')!;
    expect(lines.map((l) => [l.refs.sale, l.fields.line_number, l.fields.line_total])).toEqual([
      ['#1001', 1, 18],
      ['#1001', 2, 36],
      ['#1002', 1, 18],
      ['#1003', 1, 15],
    ]);
  });

  it('drops records missing a required detail and explains why', () => {
    expect(result.stats.entities.sale!.dropped).toBe(1);
    const issue = result.issues.find((i) => i.code === 'unreadable_value');
    expect(issue).toMatchObject({
      entity: 'sale',
      row: 5,
      message: 'couldn’t read “not a date” as a date',
    });
    expect(result.issues.find((i) => i.code === 'missing_required')?.message).toBe(
      'has no date, so we left it out',
    );
  });

  it('merges customers by email and links records', () => {
    const customers = result.entities.get('customer')!;
    expect(customers.map((c) => c.fields.name)).toEqual(['Ann Lee', 'Bob Day']);
    const sales = result.entities.get('sale')!;
    expect(sales.map((s) => s.links.customer)).toEqual([0, 1]);
    const lines = result.entities.get('sale_line')!;
    expect(lines.map((l) => l.links.product)).toEqual([0, 1, 0, null]);
    const productRefs = result.stats.references.find((r) => r.field === 'product')!;
    expect(productRefs).toMatchObject({ matched: 3, unmatched: 1, unmatchedExamples: ['Vase'] });
  });

  it('keeps lineage back to the original file rows', () => {
    const first = result.entities.get('sale')![0]!;
    expect(first.lineage.map((l) => l.row)).toEqual([2, 3]);
    expect(first.lineage[0]!.fileName).toBe('Website.xlsx');
  });

  it('treats spelling variants as one record when the owner says so', () => {
    const customers = table('f2:0:0', 'Wholesale', [
      ['Invoice', 'Customer', 'Date'],
      ['INV-1', 'Bloom & Co', '2026-01-05'],
      ['INV-2', 'BLOOM & CO LTD', '2026-02-05'],
      ['INV-3', 'Bloom and Co.', '2026-03-05'],
    ]);
    const p: ModelProposal = {
      sources: [
        {
          sourceId: 'f2:0:0',
          decision: 'map',
          rowRules: [],
          targets: [
            {
              entity: 'customer',
              grain: 'group',
              groupBy: [1],
              fields: [
                { field: 'name', source: { kind: 'column', column: 1 }, rules: [], confidence: 1 },
              ],
            },
          ],
        },
      ],
      dedupe: [
        {
          entity: 'customer',
          clusters: [{ canonical: 'Bloom & Co', variants: ['BLOOM & CO LTD', 'Bloom and Co.'] }],
        },
      ],
      assumptions: [],
      questions: [],
    };
    const r = materialize([customers], p, specs, { dateOrder: 'MDY' });
    expect(r.entities.get('customer')!.map((c) => c.fields.name)).toEqual(['Bloom & Co']);
    expect(r.stats.entities.customer).toMatchObject({ records: 1, merged: 2 });
  });
});
