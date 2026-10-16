import { closePools, getAppDb, workspace } from '@bizr/db';
import { getPack } from '@bizr/packs';
import { databaseAvailable } from '@bizr/platform/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyChangePlan } from '../change-plan/apply';
import { planFromPack } from '../change-plan/from-pack';
import { executeTenantQuery } from '../executor/execute';
import { runFallbackSql } from '../semantic/fallback';
import { newTenantSchemaName } from '../tenancy/names';
import { deprovisionTenant, provisionTenant } from '../tenancy/provision';

/** The fallback path end to end: accepted SQL is harmless; tenants stay isolated. */
const hasDb = await databaseAvailable();

describe.skipIf(!hasDb)('SQL fallback (integration)', () => {
  const a = { id: '', tenantSchema: newTenantSchemaName() };
  const b = { id: '', tenantSchema: newTenantSchemaName() };

  beforeAll(async () => {
    const pack = getPack('retail');
    for (const ws of [a, b]) {
      await provisionTenant(ws.tenantSchema);
      const [row] = await getAppDb()
        .insert(workspace)
        .values({
          name: 'Fallback',
          slug: `fallback-${ws.tenantSchema}`,
          tenantSchema: ws.tenantSchema,
          packId: 'retail',
          packVersion: '1.0.0',
          status: 'active',
        })
        .returning({ id: workspace.id });
      ws.id = row!.id;
      await applyChangePlan({
        workspace: ws,
        plan: planFromPack(pack, ['sale_line']),
        origin: 'system',
      });
    }
    const write = (ws: typeof a, sql: string) =>
      executeTenantQuery({
        tenant: { workspaceId: ws.id, tenantSchema: ws.tenantSchema },
        mode: 'write',
        sql,
        origin: 'system',
        path: 'system',
      });
    await write(
      a,
      "INSERT INTO sales (order_number, sale_date, _row_hash) VALUES ('A1', now(), 'h1'), ('A2', now(), 'h2'), ('GONE', now(), 'h3')",
    );
    await write(a, "UPDATE sales SET _deleted_at = now() WHERE order_number = 'GONE'");
    await write(b, "INSERT INTO sales (order_number, sale_date) VALUES ('SECRET', now())");
  });

  afterAll(async () => {
    for (const ws of [a, b]) {
      await deprovisionTenant(ws.tenantSchema);
      await getAppDb().delete(workspace).where(eq(workspace.id, ws.id));
    }
    await closePools();
  });

  it('answers ordinary questions without deleted records', async () => {
    const r = await runFallbackSql(a, 'select order_number from sales order by order_number');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.rows).toEqual([{ order_number: 'A1' }, { order_number: 'A2' }]);
  });

  it('never shows internal columns, even through *', async () => {
    const r = await runFallbackSql(a, 'select * from sales');
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.result.rows[0]!)).not.toContain('_row_hash');
  });

  it('keeps other businesses out of reach', async () => {
    for (const sql of [
      `select * from ${b.tenantSchema}.sales`,
      `select * from "${b.tenantSchema}"."sales"`,
      "select set_config('search_path', '" + b.tenantSchema + "', true)",
    ]) {
      const r = await runFallbackSql(a, sql);
      expect(r.ok, sql).toBe(false);
    }
    const r = await runFallbackSql(
      a,
      "select count(*) as n from sales where order_number = 'SECRET'",
    );
    expect(r.ok && r.result.rows[0]!.n).toBe('0');
  });

  it('stops runaway work with the row cap and the timeout', async () => {
    const big = await runFallbackSql(a, 'select * from generate_series(1, 100000) g', {
      rowLimit: 100,
    });
    expect(big.ok && big.result.truncated).toBe(true);
    const slow = await runFallbackSql(
      a,
      'select count(*) from generate_series(1, 100000000) x, generate_series(1, 100) y',
      { timeoutMs: 500 },
    );
    expect(slow.ok).toBe(false);
    if (!slow.ok) expect(slow.userMessage).toMatch(/took too long/);
  });
});
