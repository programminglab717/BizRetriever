import { describe, expect, it } from 'vitest';

import { type ChangePlanError, compileChangePlan, type CatalogEntity } from './compile';
import type { ChangePlan } from './schema';

/** M6 structural changes: renames, kinds, allowed values, unlinking. Pure; golden SQL. */
const S = 't_abcdefghij';

const base: ChangePlan = {
  ops: [
    {
      op: 'create_entity',
      key: 'customer',
      label: { singular: 'Customer', plural: 'Customers' },
      description: '',
      fields: [{ key: 'name', label: 'Name', type: 'text', required: true, pii: false }],
      naturalKeys: [['name']],
    },
    {
      op: 'create_entity',
      key: 'sale',
      label: { singular: 'Sale', plural: 'Sales' },
      description: '',
      fields: [
        { key: 'order_number', label: 'Order', type: 'text', required: false, pii: false },
        { key: 'sale_date', label: 'Date', type: 'datetime', required: true, pii: false },
        { key: 'quantity_text', label: 'Qty', type: 'text', required: false, pii: false },
        { key: 'total', label: 'Total', type: 'money', required: false, pii: false },
        { key: 'items', label: 'Items', type: 'integer', required: false, pii: false },
        {
          key: 'status',
          label: 'Status',
          type: 'text',
          required: false,
          pii: false,
          allowedValues: ['completed', 'cancelled'],
        },
        {
          key: 'customer',
          label: 'Customer',
          type: 'reference',
          references: 'customer',
          required: false,
          pii: false,
        },
      ],
      naturalKeys: [['order_number']],
      timeField: 'sale_date',
    },
  ],
};
const catalog: CatalogEntity[] = compileChangePlan(S, [], base).catalog;
const compile = (plan: ChangePlan) => compileChangePlan(S, catalog, plan);
const problems = (plan: ChangePlan) => {
  try {
    compile(plan);
    return [];
  } catch (e) {
    return (e as ChangePlanError).problems;
  }
};

describe('renames', () => {
  it('change only the catalog and undo exactly', () => {
    const c = compile({
      ops: [
        { op: 'rename_entity', entity: 'sale', label: { singular: 'Order', plural: 'Orders' } },
        { op: 'rename_field', entity: 'sale', field: 'total', label: 'Takings' },
      ],
    });
    expect(c.statements).toEqual([]);
    expect(c.destructive).toBe(false);
    expect(c.catalog.find((e) => e.key === 'sale')!.label.plural).toBe('Orders');
    expect(c.delta).toMatchObject({
      changedEntities: ['sale'],
      changedFields: [{ entity: 'sale', field: 'total' }],
    });
    expect(c.inverse).toEqual({
      ops: [
        { op: 'rename_field', entity: 'sale', field: 'total', label: 'Total' },
        { op: 'rename_entity', entity: 'sale', label: { singular: 'Sale', plural: 'Sales' } },
      ],
    });
  });
});

describe('change_field_type', () => {
  it('widens without loss and can be changed back', () => {
    const c = compile({
      ops: [{ op: 'change_field_type', entity: 'sale', field: 'items', type: 'decimal' }],
    });
    expect(c.statements).toEqual([
      `ALTER TABLE "${S}"."sales" ALTER COLUMN "items" TYPE numeric(18,4) USING "items"::numeric(18,4)`,
    ]);
    expect(c.destructive).toBe(false);
    expect(c.inverse).toEqual({
      ops: [{ op: 'change_field_type', entity: 'sale', field: 'items', type: 'integer' }],
    });
  });

  it('reads text as numbers safely, snapshots first, and has no plain inverse', () => {
    const c = compile({
      ops: [{ op: 'change_field_type', entity: 'sale', field: 'quantity_text', type: 'decimal' }],
    });
    expect(c.statements[0]).toBe(
      `ALTER TABLE "${S}"."sales" ALTER COLUMN "quantity_text" TYPE numeric(18,4) USING CASE WHEN pg_input_is_valid(replace(btrim("quantity_text"), ',', ''), 'numeric(18,4)') THEN (replace(btrim("quantity_text"), ',', ''))::numeric(18,4) END`,
    );
    expect(c.destructive).toBe(true);
    expect(c.inverse).toBeNull();
    expect(c.snapshotTables).toEqual(['sales']);
  });

  it('turns any kind into text without loss, and drops a list when leaving text', () => {
    const c = compile({
      ops: [{ op: 'change_field_type', entity: 'sale', field: 'total', type: 'text' }],
    });
    expect(c.destructive).toBe(false);
    expect(c.inverse!.ops[0]).toEqual({
      op: 'change_field_type',
      entity: 'sale',
      field: 'total',
      type: 'money',
    });
    expect(
      problems({
        ops: [{ op: 'change_field_type', entity: 'sale', field: 'status', type: 'text' }],
      })[0],
    ).toMatch(/already text/);
    const n = compile({
      ops: [{ op: 'change_field_type', entity: 'sale', field: 'status', type: 'integer' }],
    });
    expect(
      n.catalog.find((e) => e.key === 'sale')!.fields.find((f) => f.key === 'status')!
        .allowedValues,
    ).toBeUndefined();
  });

  it('refuses links, nonsense, required details and the date that orders records', () => {
    expect(
      problems({
        ops: [{ op: 'change_field_type', entity: 'sale', field: 'customer', type: 'text' }],
      })[0],
    ).toMatch(/is a link/);
    expect(
      problems({
        ops: [{ op: 'change_field_type', entity: 'sale', field: 'sale_date', type: 'boolean' }],
      })[0],
    ).toMatch(/can't turn datetime into boolean/);
    expect(
      problems({
        ops: [{ op: 'change_field_type', entity: 'sale', field: 'sale_date', type: 'text' }],
      })[0],
    ).toMatch(/must stay a date/);
    expect(
      problems({
        ops: [{ op: 'change_field_type', entity: 'customer', field: 'name', type: 'integer' }],
      })[0],
    ).toMatch(/is required/);
  });
});

describe('allowed values', () => {
  it('adds and removes values, catalog only, each the inverse of the other', () => {
    const add = compile({
      ops: [
        {
          op: 'add_allowed_values',
          entity: 'sale',
          field: 'status',
          values: ['refunded', 'completed'],
        },
      ],
    });
    expect(add.statements).toEqual([]);
    expect(
      add.catalog.find((e) => e.key === 'sale')!.fields.find((f) => f.key === 'status')!
        .allowedValues,
    ).toEqual(['completed', 'cancelled', 'refunded']);
    expect(add.inverse).toEqual({
      ops: [{ op: 'remove_allowed_values', entity: 'sale', field: 'status', values: ['refunded'] }],
    });
    const remove = compile({
      ops: [
        { op: 'remove_allowed_values', entity: 'sale', field: 'status', values: ['cancelled'] },
      ],
    });
    expect(remove.inverse).toEqual({
      ops: [{ op: 'add_allowed_values', entity: 'sale', field: 'status', values: ['cancelled'] }],
    });
    expect(
      problems({
        ops: [{ op: 'add_allowed_values', entity: 'sale', field: 'total', values: ['x'] }],
      })[0],
    ).toMatch(/only text details/);
    expect(
      problems({
        ops: [{ op: 'remove_allowed_values', entity: 'sale', field: 'status', values: ['nope'] }],
      })[0],
    ).toMatch(/none of those values/);
  });
});

describe('remove_relationship', () => {
  it('drops the link but keeps the name as text, after a snapshot', () => {
    const c = compile({ ops: [{ op: 'remove_relationship', entity: 'sale', field: 'customer' }] });
    expect(c.statements).toEqual([
      `ALTER TABLE "${S}"."sales" DROP CONSTRAINT IF EXISTS "sales_customer_id_fk"`,
      `DROP INDEX IF EXISTS "${S}"."sales_customer_id_idx"`,
      `ALTER TABLE "${S}"."sales" DROP COLUMN "customer_id"`,
      `ALTER TABLE "${S}"."sales" RENAME COLUMN "customer_ref" TO "customer"`,
    ]);
    const f = c.catalog.find((e) => e.key === 'sale')!.fields.find((x) => x.key === 'customer')!;
    expect(f.type).toBe('text');
    expect(f.references).toBeUndefined();
    expect(c).toMatchObject({ destructive: true, inverse: null, snapshotTables: ['sales'] });
    expect(
      problems({ ops: [{ op: 'remove_relationship', entity: 'sale', field: 'total' }] })[0],
    ).toMatch(/isn't a link/);
  });
});

describe('snapshots', () => {
  it('lists the existing tables a destructive plan changes', () => {
    expect(
      compile({
        ops: [
          { op: 'remove_field', entity: 'sale', field: 'items' },
          { op: 'remove_relationship', entity: 'sale', field: 'customer' },
          { op: 'remove_entity', entity: 'customer' },
        ],
      }).snapshotTables.sort(),
    ).toEqual(['customers', 'sales']);
  });
});
