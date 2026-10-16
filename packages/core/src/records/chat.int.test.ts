import { closePools } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FakeProvider } from '../ask/fixtures';
import { executeTenantQuery } from '../executor/execute';
import { planStructureChange } from '../structure/plan';
import { loadDemoWorkspace, type DemoWorkspace } from '../testing/demo-workspace';
import { undoRecordEdit } from './service';
import { applyRecordWrite } from './write';
import { planRecordWrite } from './write-plan';

/** M6: adding and changing records by chat (Task H) and planning structure changes (Task I). */
const hasDb = await databaseAvailable();
const NOW = new Date('2026-10-13T15:00:00Z');

describe.skipIf(!hasDb)('chat writes and changes (integration)', () => {
  let demo: DemoWorkspace;
  const q = async (sql: string, params: unknown[] = []) =>
    (
      await executeTenantQuery({
        tenant: {
          workspaceId: demo.member.workspace.id,
          tenantSchema: demo.member.workspace.tenantSchema,
        },
        sql,
        params,
        origin: 'system',
        path: 'system',
      })
    ).rows;

  beforeAll(async () => {
    demo = await loadDemoWorkspace({ today: '2026-10-13', name: 'Fernwood Chat Test' });
  }, 240_000);
  afterAll(async () => {
    await demo?.dispose();
    await closePools();
  });

  it('adds a sale: card computed by code, written as one undoable batch', async () => {
    const out = await planRecordWrite(
      demo.member,
      'Add a sale: 5 Sage Stoneware Mugs to Bloom & Co today',
      {
        provider: null,
        now: NOW,
      },
    );
    expect(out).toMatchObject({ kind: 'plan' });
    if (out.kind !== 'plan') return;
    expect(out.origin).toBe('rules');
    expect(out.card).toMatchObject({
      title: 'New sale',
      items: [{ text: '5 × Sage Stoneware Mug at $18.00', total: '$90.00' }],
      total: '$90.00',
      creates: [],
      action: 'Add it',
    });
    expect(out.card.rows).toEqual(
      expect.arrayContaining([
        { label: 'Date', value: 'Today (13 Oct 2026)' },
        { label: 'Customer', value: expect.stringMatching(/Bloom/) as unknown },
      ]),
    );
    expect(out.card.assumptions.join(' ')).toMatch(/selling price, \$18\.00/);

    const before = Number(
      (await q('SELECT count(*) AS n FROM sales WHERE _deleted_at IS NULL'))[0]!.n,
    );
    const done = await applyRecordWrite({
      member: demo.member,
      userId: demo.ownerId,
      plan: out.plan,
    });
    const [sale] = await q(
      'SELECT total::text AS total, status, customer_id FROM sales WHERE _id = $1',
      [done.records[0]!.id],
    );
    expect(sale).toMatchObject({ total: '90.0000', status: 'completed' });
    expect(sale!.customer_id).not.toBeNull();
    const lines = await q(
      'SELECT quantity::text AS q, unit_price::text AS p, line_total::text AS t, product_id FROM sale_lines WHERE sale_id = $1',
      [done.records[0]!.id],
    );
    expect(lines).toEqual([
      { q: '5.0000', p: '18.0000', t: '90.0000', product_id: expect.anything() as unknown },
    ]);
    expect(
      Number((await q('SELECT count(*) AS n FROM sales WHERE _deleted_at IS NULL'))[0]!.n),
    ).toBe(before + 1);

    await undoRecordEdit(demo.member, done.batchId);
    expect(
      Number((await q('SELECT count(*) AS n FROM sales WHERE _deleted_at IS NULL'))[0]!.n),
    ).toBe(before);
    expect(
      Number(
        (
          await q(
            'SELECT count(*) AS n FROM sale_lines WHERE sale_id = $1 AND _deleted_at IS NULL',
            [done.records[0]!.id],
          )
        )[0]!.n,
      ),
    ).toBe(0);
  });

  it('shows new customers on the card, asks which one when unclear, and says what it can’t find', async () => {
    const fresh = await planRecordWrite(
      demo.member,
      'I sold 2 Amber Bud Vase to Juniper Goods yesterday',
      { provider: null, now: NOW },
    );
    expect(fresh).toMatchObject({
      kind: 'plan',
      card: { creates: ['New customer “Juniper Goods”'] },
    });
    if (fresh.kind === 'plan') {
      expect(fresh.card.rows).toContainEqual({
        label: 'Customer',
        value: 'Juniper Goods',
        isNew: true,
      });
      const r = await applyRecordWrite({
        member: demo.member,
        userId: demo.ownerId,
        plan: fresh.plan,
      });
      expect(
        (await q("SELECT count(*) AS n FROM customers WHERE name = 'Juniper Goods'"))[0]!.n,
      ).toBe('1');
      await undoRecordEdit(demo.member, r.batchId);
      expect(
        (
          await q(
            "SELECT count(*) AS n FROM customers WHERE name = 'Juniper Goods' AND _deleted_at IS NULL",
          )
        )[0]!.n,
      ).toBe('0');
    }
    const which = await planRecordWrite(
      demo.member,
      'Add a sale: 1 Amber Wood Candle to Bloom & Co',
      { provider: null, now: NOW },
    );
    expect(which).toMatchObject({ kind: 'clarify', mention: 'Amber Wood Candle' });
    if (which.kind === 'clarify') {
      expect(which.options.map((o) => o.label).sort()).toEqual([
        'Amber Wood Candle Large',
        'Amber Wood Candle Small',
      ]);
      const picked = await planRecordWrite(
        demo.member,
        'Add a sale: 1 Amber Wood Candle to Bloom & Co',
        {
          provider: null,
          now: NOW,
          choices: { 'Amber Wood Candle': which.options[0]!.id },
        },
      );
      expect(picked.kind).toBe('plan');
    }
    expect(
      await planRecordWrite(demo.member, 'Add a sale: 3 Moon Rocks to Bloom & Co', {
        provider: null,
      }),
    ).toEqual({
      kind: 'none',
      message: 'I couldn’t find a product called “Moon Rocks”.',
    });
  });

  it('changes a record’s details with a before → after card', async () => {
    const out = await planRecordWrite(
      demo.member,
      'Change the price of Sage Stoneware Mug to $20',
      { provider: null, now: NOW },
    );
    expect(out).toMatchObject({
      kind: 'plan',
      card: {
        title: 'Change product Sage Stoneware Mug',
        rows: [{ label: 'Selling price', value: '$20.00', before: '$18.00' }],
        action: 'Save the change',
      },
    });
    if (out.kind !== 'plan') return;
    const r = await applyRecordWrite({ member: demo.member, userId: demo.ownerId, plan: out.plan });
    expect(
      (await q("SELECT unit_price::text AS p FROM products WHERE name = 'Sage Stoneware Mug'"))[0]!
        .p,
    ).toBe('20.0000');
    await undoRecordEdit(demo.member, r.batchId);
    expect(
      (await q("SELECT unit_price::text AS p FROM products WHERE name = 'Sage Stoneware Mug'"))[0]!
        .p,
    ).toBe('18.0000');
    expect(
      await planRecordWrite(demo.member, 'Change the price of Sage Stoneware Mug to lots', {
        provider: null,
      }),
    ).toEqual({
      kind: 'none',
      message: 'Selling price must be a number.',
    });
  });

  it('uses the AI when the rules can’t read it, only with ids it was given, after one repair', async () => {
    const [mug] = await q("SELECT _id::text AS id FROM products WHERE name = 'Sage Stoneware Mug'");
    const provider = new FakeProvider({
      plan_record_write: [
        {
          operation: 'update',
          entity: 'product',
          records: [{ id: '999999', values: { unit_price: 21 } }],
        },
        {
          operation: 'update',
          entity: 'product',
          records: [{ id: mug!.id, values: { unit_price: 21 } }],
          assumptions: [],
        },
      ],
    });
    const out = await planRecordWrite(demo.member, 'the sage stoneware mug costs 21 now', {
      provider,
      now: NOW,
    });
    expect(out).toMatchObject({
      kind: 'plan',
      origin: 'ai',
      card: { rows: [{ label: 'Selling price', value: '$21.00' }] },
    });
    expect(provider.calls[1]!.messages[0]!.content).toContain('is not one of the candidates');
    // Record names travel only inside the data block.
    expect(provider.calls[0]!.system).not.toContain('Sage Stoneware Mug');
    expect(provider.calls[0]!.messages[0]!.content).toMatch(
      /<workspace_data>[\s\S]*Sage Stoneware Mug[\s\S]*<\/workspace_data>/,
    );
  });

  it('plans structure changes with impact, and never removes for an additive request', async () => {
    const add = await planStructureChange(
      demo.member,
      'I also want to track which salesperson made each sale',
      { provider: null },
    );
    expect(add).toMatchObject({ kind: 'plan', origin: 'rules', impact: { destructive: false } });
    if (add.kind === 'plan')
      expect(add.impact.summary).toMatch(
        /^Affects [\d,]+ sales\. No measures or dashboard charts change\.$/,
      );

    const remove = await planStructureChange(demo.member, 'Remove cost per item from products', {
      provider: null,
    });
    expect(remove).toMatchObject({
      kind: 'plan',
      impact: { destructive: true, confirmText: 'Cost per item' },
    });
    if (remove.kind === 'plan') expect(remove.impact.summary).toMatch(/would stop working/);

    const provider = new FakeProvider({
      plan_change: [
        {
          plan: { ops: [{ op: 'remove_field', entity: 'product', field: 'brand' }] },
          explanation: '',
        },
        {
          plan: {
            ops: [
              {
                op: 'add_field',
                entity: 'product',
                field: {
                  key: 'material',
                  label: 'Material',
                  type: 'text',
                  required: false,
                  pii: false,
                },
              },
            ],
          },
          explanation: 'Products get a place to note what they are made of.',
        },
      ],
    });
    const ai = await planStructureChange(
      demo.member,
      'I want to know what each product is made from',
      { provider },
    );
    expect(ai).toMatchObject({
      kind: 'plan',
      origin: 'ai',
      impact: { destructive: false },
      explanation: 'Products get a place to note what they are made of.',
    });
    expect(JSON.stringify(provider.calls[1]!.messages)).toContain('did not ask to remove');
  });
});
