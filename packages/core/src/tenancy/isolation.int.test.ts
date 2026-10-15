/**
 * Tenant isolation suite (ARCHITECTURE §6, safety rule 2). These tests are the contract that a bug in
 * AI-produced SQL can never read or change another business's data. Never weaken them.
 */
import { closePools, getAppDb, getPool, queryRun, workspace } from '@bizr/db';
import { getEnv } from '@bizr/platform';
import { databaseAvailable } from '@bizr/platform/testing';
import { eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { executeTenantQuery, QueryExecutionError, type TenantRef } from '../executor/execute';
import { ident } from '../sql/ident';
import { newTenantSchemaName, tenantNames } from './names';
import { deprovisionTenant, provisionTenant } from './provision';

const hasDb = await databaseAvailable();

async function createWorkspaceRow(schema: string): Promise<TenantRef> {
  const [row] = await getAppDb()
    .insert(workspace)
    .values({
      name: `Isolation ${schema}`,
      slug: `iso-${schema}`,
      tenantSchema: schema,
      packId: 'retail',
      packVersion: '1.0.0',
      status: 'active',
    })
    .returning({ id: workspace.id });
  return { workspaceId: row!.id, tenantSchema: schema };
}

/** Creates a table with rows as the admin role (how the change-plan applier will create tables). */
async function seedItems(schema: string, label: string): Promise<void> {
  const s = ident(schema);
  await getPool('admin').query(
    `CREATE TABLE ${s}.items (_id bigint generated always as identity primary key, label text);
     INSERT INTO ${s}.items (label) VALUES ('${label}-1'), ('${label}-2');
     CREATE TABLE ${ident(`${schema}_snap`)}.items_backup AS TABLE ${s}.items;`,
  );
}

async function expectDenied(promise: Promise<unknown>, pattern = /permission denied/) {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err, 'expected the database to refuse').toBeDefined();
  const message = err instanceof QueryExecutionError ? err.message : String((err as Error).message);
  expect(message).toMatch(pattern);
}

describe.skipIf(!hasDb)('tenant isolation (integration)', () => {
  const a = newTenantSchemaName();
  const b = newTenantSchemaName();
  let tenantA: TenantRef;
  let tenantB: TenantRef;
  const extraClients: pg.Client[] = [];

  async function connectAs(url: string) {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    extraClients.push(client);
    return client;
  }

  beforeAll(async () => {
    await provisionTenant(a);
    await provisionTenant(b);
    // Idempotent: provisioning twice must not fail.
    await provisionTenant(a);
    await seedItems(a, 'a');
    await seedItems(b, 'b');
    tenantA = await createWorkspaceRow(a);
    tenantB = await createWorkspaceRow(b);
  });

  afterAll(async () => {
    await Promise.all(extraClients.map((c) => c.end()));
    await deprovisionTenant(a);
    await deprovisionTenant(b);
    await getAppDb()
      .delete(workspace)
      .where(inArray(workspace.tenantSchema, [a, b]));
    await closePools();
  });

  it("reads its own tenant's data through the executor", async () => {
    const result = await executeTenantQuery({
      tenant: tenantA,
      sql: 'SELECT label FROM items ORDER BY _id',
      origin: 'system',
      path: 'system',
    });
    expect(result.rows).toEqual([{ label: 'a-1' }, { label: 'a-2' }]);
    expect(result.truncated).toBe(false);
  });

  it("cannot read another tenant's table, even schema-qualified", async () => {
    await expectDenied(
      executeTenantQuery({
        tenant: tenantA,
        sql: `SELECT label FROM ${ident(b)}.items`,
        origin: 'system',
        path: 'system',
      }),
    );
  });

  it("cannot read another tenant's data in write mode either", async () => {
    await expectDenied(
      executeTenantQuery({
        tenant: tenantA,
        mode: 'write',
        sql: `SELECT label FROM ${ident(b)}.items`,
        origin: 'system',
        path: 'system',
      }),
    );
  });

  it('cannot read its own snapshot schema', async () => {
    await expectDenied(
      executeTenantQuery({
        tenant: tenantA,
        sql: `SELECT * FROM ${ident(`${a}_snap`)}.items_backup`,
        origin: 'system',
        path: 'system',
      }),
    );
  });

  it('cannot read the control plane', async () => {
    await expectDenied(
      executeTenantQuery({
        tenant: tenantA,
        sql: 'SELECT * FROM app.workspace',
        origin: 'system',
        path: 'system',
      }),
    );
  });

  it('only sees its own schema on the search path', async () => {
    await expectDenied(
      executeTenantQuery({
        tenant: tenantA,
        sql: 'SELECT * FROM job_run',
        origin: 'system',
        path: 'system',
      }),
      /does not exist/,
    );
  });

  it('cannot switch to another tenant role or undo its settings via set_config', async () => {
    await expectDenied(
      executeTenantQuery({
        tenant: tenantA,
        sql: `SELECT set_config('role', '${tenantNames(b).readerRole}', true)`,
        origin: 'system',
        path: 'system',
      }),
      /permission denied for function set_config/,
    );
    await expectDenied(
      executeTenantQuery({
        tenant: tenantA,
        sql: "SELECT set_config('statement_timeout', '0', true)",
        origin: 'system',
        path: 'system',
      }),
      /permission denied for function set_config/,
    );
  });

  it('read mode cannot write', async () => {
    await expectDenied(
      executeTenantQuery({
        tenant: tenantA,
        sql: "INSERT INTO items (label) VALUES ('x') RETURNING _id",
        origin: 'system',
        path: 'system',
      }),
      /read-only transaction|cannot execute INSERT|syntax error/,
    );
  });

  it('the writer can insert and update but not delete or change structure', async () => {
    const write = (sql: string) =>
      executeTenantQuery({
        tenant: tenantA,
        mode: 'write',
        sql,
        origin: 'records',
        path: 'system',
      });
    await expect(write("INSERT INTO items (label) VALUES ('a-3')")).resolves.toMatchObject({
      rowCount: 1,
    });
    await expect(
      write("UPDATE items SET label = 'a-3b' WHERE label = 'a-3'"),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expectDenied(write("DELETE FROM items WHERE label = 'a-3b'"));
    await expectDenied(write('CREATE TABLE sneaky (id int)'));
    await expectDenied(write('DROP TABLE items'), /must be owner|permission denied/);
    await expectDenied(
      write('ALTER TABLE items ADD COLUMN x int'),
      /must be owner|permission denied/,
    );
  });

  it('the control-plane role cannot read tenant data', async () => {
    await expectDenied(getPool('app').query(`SELECT * FROM ${ident(a)}.items`));
  });

  it('the broker login role sees nothing without SET ROLE', async () => {
    const broker = await connectAs(getEnv().DATABASE_URL_TENANT);
    await expectDenied(broker.query(`SELECT * FROM ${ident(a)}.items`));
  });

  it('the broker login role cannot assume the admin role', async () => {
    const broker = await connectAs(getEnv().DATABASE_URL_TENANT);
    const adminRole = decodeURIComponent(new URL(getEnv().DATABASE_URL_ADMIN).username);
    await expectDenied(broker.query(`SET ROLE ${ident(adminRole)}`));
  });

  it('enforces the statement timeout', async () => {
    const err = await executeTenantQuery({
      tenant: tenantA,
      sql: 'SELECT pg_sleep(2)',
      timeoutMs: 200,
      origin: 'system',
      path: 'system',
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QueryExecutionError);
    expect((err as QueryExecutionError).code).toBe('57014');
    expect((err as QueryExecutionError).userMessage).toMatch(/took too long/);
  });

  it('caps the number of rows returned and reports truncation', async () => {
    const result = await executeTenantQuery({
      tenant: tenantA,
      sql: 'SELECT g FROM generate_series(1, 25) AS g ORDER BY g',
      rowLimit: 10,
      origin: 'system',
      path: 'system',
    });
    expect(result.rowCount).toBe(10);
    expect(result.truncated).toBe(true);
    expect(result.rows.at(-1)).toEqual({ g: 10 });
  });

  it('passes values as parameters', async () => {
    const result = await executeTenantQuery({
      tenant: tenantA,
      sql: 'SELECT label FROM items WHERE label = $1',
      params: ["a-1' OR '1'='1"],
      origin: 'system',
      path: 'system',
    });
    expect(result.rows).toEqual([]);
  });

  it('records every execution, including failures, in query_run', async () => {
    const runs = await getAppDb()
      .select()
      .from(queryRun)
      .where(eq(queryRun.workspaceId, tenantA.workspaceId));
    expect(runs.length).toBeGreaterThanOrEqual(10);
    expect(runs.some((r) => r.error !== null)).toBe(true);
    expect(runs.every((r) => r.sqlHash.length === 64)).toBe(true);
    const otherTenant = await getAppDb()
      .select()
      .from(queryRun)
      .where(eq(queryRun.workspaceId, tenantB.workspaceId));
    expect(otherTenant).toEqual([]);
  });

  it('deprovisioning removes schemas and roles', async () => {
    const temp = newTenantSchemaName();
    await provisionTenant(temp);
    await deprovisionTenant(temp);
    const names = tenantNames(temp);
    const admin = getPool('admin');
    const schemas = await admin.query('select 1 from pg_namespace where nspname = any($1)', [
      [names.schema, names.snapshotSchema],
    ]);
    const roles = await admin.query('select 1 from pg_roles where rolname = any($1)', [
      [names.readerRole, names.writerRole],
    ]);
    expect(schemas.rowCount).toBe(0);
    expect(roles.rowCount).toBe(0);
  });
});
