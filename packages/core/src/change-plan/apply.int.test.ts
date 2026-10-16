import { closePools, getAppDb, getPool, migration, workspace } from '@bizr/db';
import { getPack } from '@bizr/packs';
import { databaseAvailable } from '@bizr/platform/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { executeTenantQuery } from '../executor/execute';
import { newTenantSchemaName } from '../tenancy/names';
import { deprovisionTenant, provisionTenant } from '../tenancy/provision';
import { applyChangePlan, DestructiveChangeNotConfirmedError, loadCatalog } from './apply';
import { ChangePlanError } from './compile';
import { planFromPack } from './from-pack';

const hasDb = await databaseAvailable();

describe.skipIf(!hasDb)('applying change plans (integration)', () => {
  const schemaName = newTenantSchemaName();
  let ws: { id: string; tenantSchema: string };

  beforeAll(async () => {
    await provisionTenant(schemaName);
    const [row] = await getAppDb()
      .insert(workspace)
      .values({
        name: 'Plan Test',
        slug: `plan-${schemaName}`,
        tenantSchema: schemaName,
        packId: 'retail',
        packVersion: '1.0.0',
        status: 'active',
      })
      .returning({ id: workspace.id });
    ws = { id: row!.id, tenantSchema: schemaName };
  });

  afterAll(async () => {
    await deprovisionTenant(schemaName);
    await getAppDb().delete(workspace).where(eq(workspace.id, ws.id));
    await closePools();
  });

  it('creates the whole retail model, the catalog and migration v1 together', async () => {
    const pack = getPack('retail');
    const result = await applyChangePlan({
      workspace: ws,
      plan: planFromPack(
        pack,
        pack.entities.map((e) => e.id),
      ),
      origin: 'ingestion',
    });
    expect(result.version).toBe(1);

    const catalog = await loadCatalog(ws.id);
    expect(catalog.map((e) => e.key).sort()).toEqual(pack.entities.map((e) => e.id).sort());
    expect(catalog.reduce((n, e) => n + e.fields.length, 0)).toBe(86);
    expect(catalog.find((e) => e.key === 'sale')).toMatchObject({
      tableName: 'sales',
      timeField: 'sale_date',
    });

    // New tables are readable by the tenant's reader role (default privileges) and empty.
    const read = await executeTenantQuery({
      tenant: { workspaceId: ws.id, tenantSchema: schemaName },
      sql: 'SELECT count(*)::int AS n FROM sale_lines',
      origin: 'system',
      path: 'system',
    });
    expect(read.rows).toEqual([{ n: 0 }]);

    // The writer can insert, including through foreign keys.
    const write = (sql: string) =>
      executeTenantQuery({
        tenant: { workspaceId: ws.id, tenantSchema: schemaName },
        mode: 'write',
        sql,
        origin: 'records',
        path: 'system',
      });
    await write("INSERT INTO suppliers (name) VALUES ('Kiln Co')");
    await write(
      "INSERT INTO products (name, supplier_id, supplier_ref) SELECT 'Sage Mug', _id, 'Kiln Co' FROM suppliers",
    );
    const joined = await executeTenantQuery({
      tenant: { workspaceId: ws.id, tenantSchema: schemaName },
      sql: 'SELECT p.name, s.name AS supplier FROM products p JOIN suppliers s ON s._id = p.supplier_id',
      origin: 'system',
      path: 'system',
    });
    expect(joined.rows).toEqual([{ name: 'Sage Mug', supplier: 'Kiln Co' }]);

    // System views join each record to what it links to, and the reader can use them.
    const view = await executeTenantQuery({
      tenant: { workspaceId: ws.id, tenantSchema: schemaName },
      sql: 'SELECT name, supplier__name FROM v_products_enriched',
      origin: 'system',
      path: 'system',
    });
    expect(view.rows).toEqual([{ name: 'Sage Mug', supplier__name: 'Kiln Co' }]);
  });

  it('is all-or-nothing: an invalid plan changes neither tables nor catalog', async () => {
    const before = await loadCatalog(ws.id);
    await expect(
      applyChangePlan({
        workspace: ws,
        plan: {
          ops: [
            {
              op: 'add_field',
              entity: 'product',
              field: { key: 'name', label: 'Dup', type: 'text', required: false, pii: false },
            },
          ],
        },
        origin: 'chat',
      }),
    ).rejects.toThrow(ChangePlanError);
    expect(await loadCatalog(ws.id)).toEqual(before);
  });

  it('adds a field as migration v2 and refuses unconfirmed destructive changes', async () => {
    const added = await applyChangePlan({
      workspace: ws,
      plan: {
        ops: [
          {
            op: 'add_field',
            entity: 'sale',
            field: {
              key: 'salesperson',
              label: 'Salesperson',
              type: 'text',
              required: false,
              pii: false,
            },
          },
        ],
      },
      origin: 'chat',
    });
    expect(added.version).toBe(2);
    const cols = await getPool('admin').query(
      "select column_name from information_schema.columns where table_schema = $1 and table_name = 'sales' and column_name = 'salesperson'",
      [schemaName],
    );
    expect(cols.rowCount).toBe(1);

    await expect(
      applyChangePlan({
        workspace: ws,
        plan: { ops: [{ op: 'remove_field', entity: 'sale', field: 'salesperson' }] },
        origin: 'chat',
      }),
    ).rejects.toThrow(DestructiveChangeNotConfirmedError);

    const versions = await getAppDb()
      .select()
      .from(migration)
      .where(eq(migration.workspaceId, ws.id));
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);
  });
});
