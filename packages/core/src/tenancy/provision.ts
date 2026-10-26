import { getPool } from '@bizr/db';
import { getEnv, getLogger } from '@bizr/platform';
import type pg from 'pg';

import { ident } from '../sql/ident';
import { dropTenantLogin, ensureTenantLogin, tenantLoginsEnabled } from './login';
import { tenantNames, type TenantNames } from './names';

function roleName(url: string): string {
  return decodeURIComponent(new URL(url).username);
}

/**
 * Creates a tenant's schemas and roles (ARCHITECTURE §6). Runs as `bizr_admin`, which owns tenant
 * schemas. Idempotent: safe to re-run after a partial failure.
 *
 * - `t_x_reader`: USAGE on t_x and SELECT on its tables. Nothing else.
 * - `t_x_writer`: reader + INSERT/UPDATE (no DELETE: records are soft-deleted; no DDL).
 * - `t_x_snap`: rollback snapshots; no tenant role can see it.
 * - With per-business logins (ADR-055), `t_x_login` may become those two roles and nothing else.
 *   Without them, the broker login role (`bizr_tenant`, NOINHERIT) is granted both roles. Either way
 *   the safe executor `SET LOCAL ROLE`s to exactly one tenant per transaction.
 */
export async function provisionTenant(schema: string): Promise<TenantNames> {
  const names = tenantNames(schema);
  const env = getEnv();
  const admin = ident(roleName(env.DATABASE_URL_ADMIN));
  const broker = ident(roleName(env.DATABASE_URL_TENANT));
  const s = ident(names.schema);
  const reader = ident(names.readerRole);
  const writer = ident(names.writerRole);

  const client = await getPool('admin').connect();
  try {
    await client.query('BEGIN');
    await ensureRole(client, names.readerRole);
    await ensureRole(client, names.writerRole);
    await client.query(`GRANT ${reader} TO ${writer}`);

    await client.query(`CREATE SCHEMA IF NOT EXISTS ${s}`);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${ident(names.snapshotSchema)}`);
    await client.query(`REVOKE ALL ON SCHEMA ${s} FROM PUBLIC`);
    await client.query(`REVOKE ALL ON SCHEMA ${ident(names.snapshotSchema)} FROM PUBLIC`);

    await client.query(`GRANT USAGE ON SCHEMA ${s} TO ${reader}`);
    // Privileges on tables/sequences the admin role creates later in this schema.
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${admin} IN SCHEMA ${s} GRANT SELECT ON TABLES TO ${reader}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${admin} IN SCHEMA ${s} GRANT INSERT, UPDATE ON TABLES TO ${writer}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${admin} IN SCHEMA ${s} GRANT USAGE, SELECT ON SEQUENCES TO ${writer}`,
    );
    // Default privileges make every function executable by PUBLIC; tenant schemas never expose any.
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${admin} IN SCHEMA ${s} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`,
    );

    if (tenantLoginsEnabled()) await ensureTenantLogin(schema, client);
    else await client.query(`GRANT ${reader}, ${writer} TO ${broker}`);
    await client.query('COMMIT');
    getLogger('tenancy').info({ schema }, 'tenant provisioned');
    return names;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Drops a tenant's schemas (and all its data) and roles. Irreversible: callers must confirm first. */
export async function deprovisionTenant(schema: string): Promise<void> {
  const names = tenantNames(schema);
  const client = await getPool('admin').connect();
  try {
    await client.query('BEGIN');
    // Dropping the schemas also removes their per-schema default privileges.
    await client.query(`DROP SCHEMA IF EXISTS ${ident(names.schema)} CASCADE`);
    await client.query(`DROP SCHEMA IF EXISTS ${ident(names.snapshotSchema)} CASCADE`);
    await dropTenantLogin(client, schema);
    await client.query(`DROP ROLE IF EXISTS ${ident(names.writerRole)}`);
    await client.query(`DROP ROLE IF EXISTS ${ident(names.readerRole)}`);
    await client.query('COMMIT');
    getLogger('tenancy').info({ schema }, 'tenant deprovisioned');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function ensureRole(client: pg.PoolClient, name: string): Promise<void> {
  const exists = await client.query('select 1 from pg_roles where rolname = $1', [name]);
  if (!exists.rowCount) {
    // INHERIT (default) so the writer role gets the reader role's SELECT privileges.
    await client.query(`CREATE ROLE ${ident(name)} NOLOGIN`);
  }
}

/**
 * Refreshes the planner's statistics for a tenant's tables. Run after every bulk load: without it a
 * freshly loaded table looks empty to Postgres and joins over it can take seconds instead of
 * milliseconds. Runs as `bizr_admin`, which owns tenant tables.
 */
export async function analyzeTenant(schema: string): Promise<void> {
  const client = await getPool('admin').connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      'SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename',
      [schema],
    );
    for (const r of rows) await client.query(`ANALYZE ${ident(schema)}.${ident(r.tablename)}`);
  } finally {
    client.release();
  }
}
