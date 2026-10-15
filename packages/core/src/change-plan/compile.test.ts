import { getPack } from '@bizr/packs';
import { describe, expect, it } from 'vitest';

import { ChangePlanError, compileChangePlan, type CatalogEntity } from './compile';
import { planFromPack } from './from-pack';
import { tableNameFor } from './names';
import type { ChangePlan } from './schema';

const SCHEMA = 't_abcdefghij';

const productPlan: ChangePlan = {
  ops: [
    {
      op: 'create_entity',
      key: 'supplier',
      label: { singular: 'Supplier', plural: 'Suppliers' },
      description: '',
      fields: [{ key: 'name', label: 'Name', type: 'text', required: true, pii: false }],
      naturalKeys: [['name']],
    },
    {
      op: 'create_entity',
      key: 'product',
      label: { singular: 'Product', plural: 'Products' },
      description: '',
      fields: [
        { key: 'sku', label: 'SKU', type: 'text', required: false, pii: false },
        { key: 'name', label: 'Name', type: 'text', required: true, pii: false },
        { key: 'unit_price', label: 'Price', type: 'money', required: false, pii: false },
        {
          key: 'supplier',
          label: 'Supplier',
          type: 'reference',
          references: 'supplier',
          required: false,
          pii: false,
        },
      ],
      naturalKeys: [['sku'], ['name']],
    },
  ],
};

describe('tableNameFor', () => {
  it.each([
    ['product', 'products'],
    ['sale_line', 'sale_lines'],
    ['stock_count', 'stock_counts'],
    ['category', 'categories'],
    ['address', 'addresses'],
    ['batch', 'batches'],
    ['day', 'days'],
  ])('%s → %s', (key, table) => expect(tableNameFor(key)).toBe(table));
});

describe('compileChangePlan', () => {
  it('creates tables with system columns, then foreign keys', () => {
    const compiled = compileChangePlan(SCHEMA, [], productPlan);
    expect(compiled.statements).toMatchSnapshot();
    expect(compiled.delta.createdEntities).toEqual(['supplier', 'product']);
    expect(compiled.destructive).toBe(false);
    expect(compiled.inverse).toEqual({
      ops: [
        { op: 'remove_entity', entity: 'product' },
        { op: 'remove_entity', entity: 'supplier' },
      ],
    });
    // FKs come after every CREATE TABLE.
    const lastCreate = compiled.statements.findLastIndex((s) => s.startsWith('CREATE TABLE'));
    const firstFk = compiled.statements.findIndex((s) => s.includes('FOREIGN KEY'));
    expect(firstFk).toBeGreaterThan(lastCreate);
  });

  it('compiles the whole retail pack deterministically (golden DDL)', () => {
    const pack = getPack('retail');
    const plan = planFromPack(
      pack,
      pack.entities.map((e) => e.id),
    );
    const a = compileChangePlan(SCHEMA, [], plan);
    const b = compileChangePlan(SCHEMA, [], plan);
    expect(a.statements).toEqual(b.statements);
    expect(a.statements.join(';\n\n')).toMatchSnapshot();
    expect(a.catalog).toHaveLength(13);
  });

  it('pulls in linked pack entities automatically', () => {
    const plan = planFromPack(getPack('retail'), ['sale_line']);
    expect(plan.ops.map((o) => (o.op === 'create_entity' ? o.key : ''))).toEqual([
      'product',
      'customer',
      'supplier',
      'location',
      'sale',
      'sale_line',
    ]);
  });

  it('adds fields to existing tables without NOT NULL', () => {
    const { catalog } = compileChangePlan(SCHEMA, [], productPlan);
    const compiled = compileChangePlan(SCHEMA, catalog, {
      ops: [
        {
          op: 'add_field',
          entity: 'product',
          field: {
            key: 'salesperson',
            label: 'Salesperson',
            type: 'text',
            required: true,
            pii: false,
          },
        },
        { op: 'create_index', entity: 'product', fields: ['salesperson'] },
      ],
    });
    expect(compiled.statements).toEqual([
      `ALTER TABLE "${SCHEMA}"."products" ADD COLUMN "salesperson" text`,
      `CREATE INDEX IF NOT EXISTS "products_salesperson_idx" ON "${SCHEMA}"."products" ("salesperson")`,
    ]);
    expect(compiled.inverse).toEqual({
      ops: [{ op: 'remove_field', entity: 'product', field: 'salesperson' }],
    });
  });

  it('marks removals as destructive and not invertible', () => {
    const { catalog } = compileChangePlan(SCHEMA, [], productPlan);
    const compiled = compileChangePlan(SCHEMA, catalog, {
      ops: [{ op: 'remove_field', entity: 'product', field: 'supplier' }],
    });
    expect(compiled.statements).toEqual([
      `ALTER TABLE "${SCHEMA}"."products" DROP COLUMN "supplier_id"`,
      `ALTER TABLE "${SCHEMA}"."products" DROP COLUMN "supplier_ref"`,
    ]);
    expect(compiled.destructive).toBe(true);
    expect(compiled.inverse).toBeNull();
  });

  it('reports every problem and compiles nothing', () => {
    const { catalog } = compileChangePlan(SCHEMA, [], productPlan);
    const run = () =>
      compileChangePlan(SCHEMA, catalog, {
        ops: [
          {
            op: 'create_entity',
            key: 'product',
            label: { singular: 'P', plural: 'Ps' },
            description: '',
            fields: [{ key: 'name', label: 'N', type: 'text', required: false, pii: false }],
            naturalKeys: [],
          },
          {
            op: 'add_field',
            entity: 'nothing',
            field: { key: 'x', label: 'X', type: 'text', required: false, pii: false },
          },
          { op: 'remove_entity', entity: 'supplier' },
          { op: 'remove_field', entity: 'product', field: 'sku' },
          {
            op: 'create_entity',
            key: 'order',
            label: { singular: 'O', plural: 'Os' },
            description: '',
            fields: [
              {
                key: 'buyer',
                label: 'B',
                type: 'reference',
                references: 'ghost',
                required: false,
                pii: false,
              },
            ],
            naturalKeys: [['missing']],
          },
        ],
      });
    expect(run).toThrow(ChangePlanError);
    try {
      run();
    } catch (err) {
      const problems = (err as ChangePlanError).problems.join('\n');
      expect(problems).toContain('"product" already exists');
      expect(problems).toContain('unknown entity "nothing"');
      expect(problems).toContain('"supplier" is linked from "product"');
      expect(problems).toContain('used to match or date records');
      expect(problems).toContain('unknown field "missing"');
    }
  });

  it('rejects unsafe or reserved keys at the schema level', () => {
    const bad = (key: string) =>
      compileChangePlan(SCHEMA, [], {
        ops: [
          {
            op: 'create_entity',
            key,
            label: { singular: 'X', plural: 'Xs' },
            description: '',
            fields: [{ key: 'name', label: 'N', type: 'text', required: false, pii: false }],
            naturalKeys: [],
          },
        ],
      });
    for (const key of [
      'Products',
      'drop table x',
      'x"; drop',
      '_hidden',
      'customer_id',
      'a'.repeat(50),
    ]) {
      expect(() => bad(key), key).toThrow();
    }
  });

  it('never lets a field key collide with system columns', () => {
    const entity: CatalogEntity = {
      key: 'thing',
      tableName: 'things',
      label: { singular: 'T', plural: 'Ts' },
      description: '',
      fields: [],
      naturalKeys: [],
    };
    expect(() =>
      compileChangePlan(SCHEMA, [entity], {
        ops: [
          {
            op: 'add_field',
            entity: 'thing',
            field: { key: '_id', label: 'x', type: 'text', required: false, pii: false },
          },
        ],
      }),
    ).toThrow();
  });
});
