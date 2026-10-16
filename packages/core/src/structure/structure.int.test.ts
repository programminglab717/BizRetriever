import { closePools, getAppDb, getPool, snapshot } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadCatalog } from '../change-plan/apply';
import type { ChangePlan } from '../change-plan/schema';
import { executeTenantQuery } from '../executor/execute';
import { editRecord } from '../records/service';
import { loadDemoWorkspace, type DemoWorkspace } from '../testing/demo-workspace';
import { snapshotGcJob } from './gc';
import {
  analyzeChange,
  listChanges,
  makeStructuralChange,
  previewUndo,
  StructureError,
  undoStructuralChange,
} from './service';

/**
 * M6 acceptance: every structural change is versioned and can be undone (one test per op), and
 * destructive changes always snapshot first.
 */
const hasDb = await databaseAvailable();

describe.skipIf(!hasDb)('structural changes (integration)', () => {
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
  const field = async (entity: string, key: string) =>
    (await loadCatalog(demo.member.workspace.id))
      .find((e) => e.key === entity)
      ?.fields.find((f) => f.key === key);
  const change = (plan: ChangePlan, confirmation?: string) =>
    makeStructuralChange({
      member: demo.member,
      userId: demo.ownerId,
      plan,
      ...(confirmation ? { confirmation } : {}),
    });
  const undo = async (confirmed = false) => {
    const [latest] = await listChanges(demo.member);
    expect(latest!.canUndo).toBe(true);
    return undoStructuralChange({
      member: demo.member,
      userId: demo.ownerId,
      version: latest!.version,
      confirmed,
    });
  };
  const snapshots = async () =>
    (
      await getAppDb()
        .select()
        .from(snapshot)
        .where(eq(snapshot.workspaceId, demo.member.workspace.id))
    ).length;

  beforeAll(async () => {
    demo = await loadDemoWorkspace({ today: '2026-10-13', name: 'Fernwood Structure Test' });
  }, 240_000);
  afterAll(async () => {
    await demo?.dispose();
    await closePools();
  });

  it('adds a detail; undoing warns when it was filled in since, then removes it', async () => {
    const plan: ChangePlan = {
      ops: [
        {
          op: 'add_field',
          entity: 'product',
          field: {
            key: 'gift_wrap',
            label: 'Gift wrap',
            type: 'boolean',
            required: false,
            pii: false,
          },
        },
      ],
    };
    const impact = await analyzeChange(demo.member, plan);
    expect(impact.destructive).toBe(false);
    expect(impact.steps[0]!.text).toBe('Add “Gift wrap” to products, as yes or no');
    expect(impact.summary).toMatch(
      /^Affects 95 products\. No measures or dashboard charts change\.$/,
    );
    await change(plan);
    const [p] = await q('SELECT _id FROM products ORDER BY _id LIMIT 1');
    await editRecord({
      member: demo.member,
      userId: demo.ownerId,
      entity: 'product',
      id: String(p!._id),
      field: 'gift_wrap',
      value: 'yes',
    });

    const [latest] = await listChanges(demo.member);
    const preview = await previewUndo(demo.member, latest!.version);
    expect(preview.needsConfirmation).toBe(true);
    expect(preview.warnings[0]).toMatch(/1 products have a “Gift wrap” filled in since/);
    await expect(
      undoStructuralChange({ member: demo.member, userId: demo.ownerId, version: latest!.version }),
    ).rejects.toThrow(StructureError);
    await undo(true);
    expect(await field('product', 'gift_wrap')).toBeUndefined();
    const history = await listChanges(demo.member);
    expect(history[0]!.steps).toEqual([`Undid change ${latest!.version}`]);
    expect(history[1]!.undone).toBe(true);
    // A backup of what the undo removed was kept.
    expect(await snapshots()).toBe(1);
  });

  it('renames a record type and a detail, and undoes both', async () => {
    await change({
      ops: [
        { op: 'rename_entity', entity: 'supplier', label: { singular: 'Maker', plural: 'Makers' } },
        { op: 'rename_field', entity: 'product', field: 'unit_price', label: 'Price' },
      ],
    });
    expect((await field('product', 'unit_price'))!.label).toBe('Price');
    expect(
      (await loadCatalog(demo.member.workspace.id)).find((e) => e.key === 'supplier')!.label.plural,
    ).toBe('Makers');
    await undo();
    expect((await field('product', 'unit_price'))!.label).toBe('Selling price');
    expect(
      (await loadCatalog(demo.member.workspace.id)).find((e) => e.key === 'supplier')!.label.plural,
    ).toBe('Suppliers');
  });

  it('changes a kind without loss and back', async () => {
    const before = await q('SELECT _id, reorder_point::text AS v FROM products ORDER BY _id');
    await change({
      ops: [{ op: 'change_field_type', entity: 'product', field: 'reorder_point', type: 'text' }],
    });
    expect((await field('product', 'reorder_point'))!.type).toBe('text');
    await undo(true);
    expect((await field('product', 'reorder_point'))!.type).toBe('decimal');
    expect(await q('SELECT _id, reorder_point::text AS v FROM products ORDER BY _id')).toEqual(
      before,
    );
  });

  it('changes a kind that loses values only with typed confirmation and a snapshot, and restores them exactly', async () => {
    const before = await q('SELECT _id, sku FROM products ORDER BY _id');
    const plan: ChangePlan = {
      ops: [{ op: 'change_field_type', entity: 'product', field: 'sku', type: 'integer' }],
    };
    const impact = await analyzeChange(demo.member, plan);
    expect(impact.destructive).toBe(true);
    expect(impact.confirmText).toBe('Product code');
    expect(impact.steps[0]!.details[0]).toMatch(
      /^90 products have a “Product code” that can’t be read this way/,
    );
    await expect(change(plan, 'yes')).rejects.toThrow('To confirm, type “Product code”.');
    const snaps = await snapshots();
    await change(plan, 'product code');
    expect(await snapshots()).toBe(snaps + 1);
    expect(
      Number((await q('SELECT count(*) AS n FROM products WHERE sku IS NOT NULL'))[0]!.n),
    ).toBe(0);
    await undo();
    expect((await field('product', 'sku'))!.type).toBe('text');
    expect(await q('SELECT _id, sku FROM products ORDER BY _id')).toEqual(before);
  });

  it('adds and removes allowed values, and undoes them', async () => {
    await change({
      ops: [{ op: 'add_allowed_values', entity: 'sale', field: 'status', values: ['on_hold'] }],
    });
    expect((await field('sale', 'status'))!.allowedValues).toContain('on_hold');
    await undo();
    expect((await field('sale', 'status'))!.allowedValues).not.toContain('on_hold');
    const impact = await analyzeChange(demo.member, {
      ops: [{ op: 'remove_allowed_values', entity: 'sale', field: 'channel', values: ['etsy'] }],
    });
    expect(impact.steps[0]!.details[0]).toMatch(/sales keep their value/);
    await change({
      ops: [{ op: 'remove_allowed_values', entity: 'sale', field: 'channel', values: ['etsy'] }],
    });
    expect((await field('sale', 'channel'))!.allowedValues).not.toContain('etsy');
    await undo();
    expect((await field('sale', 'channel'))!.allowedValues).toContain('etsy');
  });

  it('removes a detail after a snapshot and brings it back', async () => {
    const before = await q('SELECT _id, category FROM products ORDER BY _id');
    const plan: ChangePlan = {
      ops: [{ op: 'remove_field', entity: 'product', field: 'category' }],
    };
    const impact = await analyzeChange(demo.member, plan);
    expect(impact).toMatchObject({ destructive: true, confirmText: 'Category' });
    expect(impact.lostTiles.length + impact.lostMeasures.length).toBeGreaterThanOrEqual(0);
    await change(plan, 'Category');
    expect(await field('product', 'category')).toBeUndefined();
    await undo();
    expect(await field('product', 'category')).toMatchObject({ label: 'Category', type: 'text' });
    expect(await q('SELECT _id, category FROM products ORDER BY _id')).toEqual(before);
  });

  it('names the measures and charts a removal would break', async () => {
    const impact = await analyzeChange(demo.member, {
      ops: [{ op: 'remove_field', entity: 'product', field: 'unit_cost' }],
    });
    expect(impact.lostMeasures.join(' ')).toMatch(/Gross profit|Stock value/i);
    expect(impact.summary).toMatch(/would stop working/);
  });

  it('unlinks, keeping names as text, and relinks exactly', async () => {
    const before = await q(
      'SELECT _id, supplier_id::text AS s, supplier_ref AS r FROM products ORDER BY _id',
    );
    await change(
      { ops: [{ op: 'remove_relationship', entity: 'product', field: 'supplier' }] },
      'Supplier',
    );
    expect((await field('product', 'supplier'))!.type).toBe('text');
    const named = await q('SELECT _id, supplier AS r FROM products ORDER BY _id');
    expect(named.map((x) => x.r)).toEqual(before.map((x) => x.r));
    await undo();
    expect((await field('product', 'supplier'))!).toMatchObject({
      type: 'reference',
      references: 'supplier',
    });
    expect(
      await q('SELECT _id, supplier_id::text AS s, supplier_ref AS r FROM products ORDER BY _id'),
    ).toEqual(before);
  });

  it('removes a whole record type and brings every record back', async () => {
    const before = await q('SELECT _id, amount::text AS a FROM expenses ORDER BY _id');
    expect(before.length).toBeGreaterThan(0);
    const plan: ChangePlan = { ops: [{ op: 'remove_entity', entity: 'expense' }] };
    expect((await analyzeChange(demo.member, plan)).confirmText).toBe('Expenses');
    await change(plan, 'expenses');
    expect((await loadCatalog(demo.member.workspace.id)).some((e) => e.key === 'expense')).toBe(
      false,
    );
    const preview = await previewUndo(demo.member, (await listChanges(demo.member))[0]!.version);
    expect(preview.warnings[0]).toMatch(/come back as they were/);
    await undo(true);
    expect(await q('SELECT _id, amount::text AS a FROM expenses ORDER BY _id')).toEqual(before);
    // New records continue the numbering.
    const max = Number(before.at(-1)!._id);
    const client = await getPool('admin').connect();
    try {
      const r = await client.query<{ v: string }>(
        `SELECT last_value::text AS v FROM pg_sequences WHERE schemaname = $1 AND sequencename LIKE 'expenses%'`,
        [demo.member.workspace.tenantSchema],
      );
      expect(Number(r.rows[0]!.v)).toBeGreaterThanOrEqual(max);
    } finally {
      client.release();
    }
  });

  it('starts tracking something new, and undoing removes it again', async () => {
    await change({
      ops: [
        {
          op: 'create_entity',
          key: 'salesperson',
          label: { singular: 'Salesperson', plural: 'Salespeople' },
          description: '',
          fields: [{ key: 'name', label: 'Name', type: 'text', required: true, pii: false }],
          naturalKeys: [['name']],
        },
        { op: 'create_index', entity: 'product', fields: ['name'] },
      ],
    });
    expect((await loadCatalog(demo.member.workspace.id)).some((e) => e.key === 'salesperson')).toBe(
      true,
    );
    await undo();
    expect((await loadCatalog(demo.member.workspace.id)).some((e) => e.key === 'salesperson')).toBe(
      false,
    );
  });

  it('only undoes the latest change, never the set-up from files', async () => {
    const history = await listChanges(demo.member);
    expect(history.filter((h) => h.canUndo)).toHaveLength(0); // the latest is an undo
    await expect(previewUndo(demo.member, history.at(-1)!.version)).rejects.toThrow(
      /latest change/,
    );
  });

  it('drops snapshots after 30 days', async () => {
    const db = getAppDb();
    const all = await db
      .select()
      .from(snapshot)
      .where(eq(snapshot.workspaceId, demo.member.workspace.id));
    expect(all.length).toBeGreaterThan(0);
    await db
      .update(snapshot)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(snapshot.workspaceId, demo.member.workspace.id));
    // The step only uses `state`.
    await snapshotGcJob.steps[0]!.run({ state: { dropped: 0 } } as unknown as Parameters<
      (typeof snapshotGcJob.steps)[number]['run']
    >[0]);
    const after = await db
      .select()
      .from(snapshot)
      .where(eq(snapshot.workspaceId, demo.member.workspace.id));
    expect(after.every((s) => s.droppedAt)).toBe(true);
    const client = await getPool('admin').connect();
    try {
      const r = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = $1`,
        [`${demo.member.workspace.tenantSchema}_snap`],
      );
      expect(r.rows[0]!.n).toBe(0);
    } finally {
      client.release();
    }
  });
});
