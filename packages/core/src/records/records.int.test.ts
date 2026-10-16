import { closePools } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { executeTenantQuery } from '../executor/execute';
import { loadDemoWorkspace, type DemoWorkspace } from '../testing/demo-workspace';
import {
  browseRecords,
  deleteRecords,
  editRecord,
  getRecord,
  listRecordTypes,
  RecordsError,
  restoreRecords,
  searchRecords,
  undoRecordEdit,
} from './service';

/** My data (M6): browse, edit, delete and restore records, every change undoable. */
const hasDb = await databaseAvailable();

describe.skipIf(!hasDb)('records (integration)', () => {
  let demo: DemoWorkspace;
  const value = async (sql: string, params: unknown[]) =>
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
    ).rows[0];

  beforeAll(async () => {
    demo = await loadDemoWorkspace({ today: '2026-10-13', name: 'Fernwood Records Test' });
  }, 240_000);
  afterAll(async () => {
    await demo?.dispose();
    await closePools();
  });

  it('lists record types with counts', async () => {
    const types = await listRecordTypes(demo.member);
    const products = types.find((t) => t.key === 'product')!;
    expect(products.count).toBe(demo.sim.products.length);
    expect(products.titleField).toBe('name');
    expect(types.find((t) => t.key === 'sale')!.count).toBeGreaterThan(1_000);
  });

  it('searches, filters, sorts and pages', async () => {
    const mugs = await browseRecords(demo.member, {
      entity: 'product',
      search: 'mug',
      sort: 'name',
      dir: 'asc',
    });
    expect(mugs.total).toBeGreaterThan(0);
    expect(mugs.rows.every((r) => /mug/i.test(Object.values(r.values).join(' ')))).toBe(true);
    const names = mugs.rows.map((r) => r.title);
    expect(names).toEqual(
      [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
    );

    const cancelled = await browseRecords(demo.member, {
      entity: 'sale',
      filters: [{ field: 'status', value: 'cancelled' }],
    });
    expect(cancelled.rows.every((r) => r.values.status === 'cancelled')).toBe(true);
    // Newest first by default; date-times in local time; customers shown by name.
    const sales = await browseRecords(demo.member, { entity: 'sale', limit: 20 });
    expect(sales.sort).toBe('sale_date');
    expect(sales.rows[0]!.values.sale_date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    const page2 = await browseRecords(demo.member, { entity: 'sale', limit: 20, offset: 20 });
    expect(page2.rows[0]!.id).not.toBe(sales.rows[0]!.id);
    const linked = sales.rows.find((r) => r.links.customer);
    if (linked) expect(linked.values.customer).not.toMatch(/^\d+$/);

    // Identifiers come from the catalog only; values are parameters.
    await expect(browseRecords(demo.member, { entity: 'pg_user' })).rejects.toThrow(RecordsError);
    const evil = await browseRecords(demo.member, {
      entity: 'product',
      search: `'; DROP TABLE products; --`,
    });
    expect(evil.total).toBe(0);
    await expect(
      browseRecords(demo.member, {
        entity: 'sale',
        filters: [{ field: 'customer', value: '1 OR 1=1' }],
      }),
    ).rejects.toThrow(RecordsError);
  });

  it('opens a record with where it came from and what links to it', async () => {
    const [bloom] = await searchRecords(demo.member, 'customer', 'Bloom');
    expect(bloom).toBeTruthy();
    const detail = await getRecord(demo.member, 'customer', bloom!.id);
    expect(detail.record.title).toMatch(/Bloom/);
    expect(detail.source?.sheet).toBeTruthy();
    expect(detail.source?.row).toBeGreaterThan(0);
    const sales = detail.linked.find((l) => l.entity === 'sale');
    expect(sales?.count).toBeGreaterThan(0);
    expect(sales?.examples.length).toBeGreaterThan(0);
  });

  it('edits a detail with type checks, logs it and undoes it', async () => {
    const [product] = (
      await browseRecords(demo.member, { entity: 'product', search: 'mug', limit: 1 })
    ).rows;
    const id = product!.id;
    const before = product!.values.unit_price;

    await expect(
      editRecord({
        member: demo.member,
        userId: demo.ownerId,
        entity: 'product',
        id,
        field: 'unit_price',
        value: 'lots',
      }),
    ).rejects.toThrow('Selling price must be a number.');

    const r = await editRecord({
      member: demo.member,
      userId: demo.ownerId,
      entity: 'product',
      id,
      field: 'unit_price',
      value: '$99.50',
    });
    expect(r.batchId).toBeTruthy();
    expect(Number(r.record!.values.unit_price)).toBe(99.5);
    // The same value again changes nothing.
    const again = await editRecord({
      member: demo.member,
      userId: demo.ownerId,
      entity: 'product',
      id,
      field: 'unit_price',
      value: '99.5',
    });
    expect(again.batchId).toBeNull();

    const detail = await getRecord(demo.member, 'product', id);
    expect(detail.history[0]).toMatchObject({
      op: 'update',
      origin: 'grid',
      by: 'Demo',
      undone: false,
    });
    expect(detail.history[0]!.changes[0]).toMatchObject({
      field: 'unit_price',
      label: 'Selling price',
    });

    await undoRecordEdit(demo.member, r.batchId!);
    const back = await value('SELECT unit_price::text AS v FROM products WHERE _id = $1', [id]);
    expect(back!.v).toBe(before);
    await expect(undoRecordEdit(demo.member, r.batchId!)).rejects.toThrow(/already undone/);
  });

  it('changes a link and a date-time', async () => {
    const [sale] = (await browseRecords(demo.member, { entity: 'sale', limit: 1 })).rows;
    const [other] = await searchRecords(demo.member, 'customer', 'Harbor');
    const r = await editRecord({
      member: demo.member,
      userId: demo.ownerId,
      entity: 'sale',
      id: sale!.id,
      field: 'customer',
      value: other!.id,
    });
    expect(r.record!.links.customer).toBe(other!.id);
    expect(r.record!.values.customer).toBe(other!.title);
    await expect(
      editRecord({
        member: demo.member,
        userId: demo.ownerId,
        entity: 'sale',
        id: sale!.id,
        field: 'customer',
        value: '999999999',
      }),
    ).rejects.toThrow('Choose a customer from the list.');

    const t = await editRecord({
      member: demo.member,
      userId: demo.ownerId,
      entity: 'sale',
      id: sale!.id,
      field: 'sale_date',
      value: '2026-10-01T09:30',
    });
    // Shown back in the workspace's local time, exactly as typed.
    expect(t.record!.values.sale_date).toBe('2026-10-01T09:30:00');
    await undoRecordEdit(demo.member, t.batchId!);
    await undoRecordEdit(demo.member, r.batchId!);
    const restored = (await getRecord(demo.member, 'sale', sale!.id)).record;
    expect(restored.values.sale_date).toBe(sale!.values.sale_date);
    expect(restored.links.customer).toBe(sale!.links.customer);
  });

  it('deletes softly, lists recently deleted, restores, and undoes', async () => {
    const before = (await listRecordTypes(demo.member)).find((t) => t.key === 'product')!.count;
    const [a, b] = (await browseRecords(demo.member, { entity: 'product', limit: 2 })).rows;
    const del = await deleteRecords({
      member: demo.member,
      userId: demo.ownerId,
      entity: 'product',
      ids: [a!.id, b!.id],
    });
    expect(del.count).toBe(2);
    expect((await listRecordTypes(demo.member)).find((t) => t.key === 'product')).toMatchObject({
      count: before - 2,
      deleted: 2,
    });
    const bin = await browseRecords(demo.member, { entity: 'product', deleted: true });
    expect(bin.rows.map((r) => r.id).sort()).toEqual([a!.id, b!.id].sort());
    // Still in the table: nothing is ever removed.
    expect(
      (await value('SELECT count(*) AS n FROM products WHERE _id = ANY($1)', [[a!.id, b!.id]]))!.n,
    ).toBe('2');

    const res = await restoreRecords({
      member: demo.member,
      userId: demo.ownerId,
      entity: 'product',
      ids: [a!.id],
    });
    expect(res.count).toBe(1);
    // One of them was restored since: that has to be undone first.
    await expect(undoRecordEdit(demo.member, del.batchId!)).rejects.toThrow(/changed again/);
    await undoRecordEdit(demo.member, res.batchId!);
    await undoRecordEdit(demo.member, del.batchId!);
    expect((await listRecordTypes(demo.member)).find((t) => t.key === 'product')!.count).toBe(
      before,
    );
  });
});
