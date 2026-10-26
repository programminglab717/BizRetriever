import { createHmac } from 'node:crypto';

import { forgetLoginPool, getLoginPool, getPool, loginGroupName } from '@bizr/db';
import { getEnv, getLogger } from '@bizr/platform';
import type pg from 'pg';

import { ident } from '../sql/ident';
import { tenantNames } from './names';

/**
 * Per-business database logins (ADR-055, ADR-005 option 3). With `TENANT_LOGIN_SECRET` set, each
 * business's queries run under its own login, `t_x_login`. It can become that business's reader or
 * writer role (`SET ROLE`) and nothing else, so no statement can switch to another business's role,
 * even where `set_config` can't be locked (managed Postgres, ADR-054). Its password is derived from
 * the secret, so nothing is stored; changing the secret and re-running `tenant-logins` rotates them.
 */

export function tenantLoginsEnabled(): boolean {
  return Boolean(getEnv().TENANT_LOGIN_SECRET);
}

function brokerName(): string {
  return decodeURIComponent(new URL(getEnv().DATABASE_URL_TENANT).username);
}

export function tenantLoginPassword(schema: string): string {
  const secret = getEnv().TENANT_LOGIN_SECRET;
  if (!secret) throw new Error('TENANT_LOGIN_SECRET is not set');
  return createHmac('sha256', secret)
    .update(`bizr-tenant-login:${tenantNames(schema).loginRole}`)
    .digest('base64url');
}

/** Same host and database as the broker login, as the business's own login. */
export function tenantConnectionString(schema: string): string {
  const url = new URL(getEnv().DATABASE_URL_TENANT);
  url.username = tenantNames(schema).loginRole;
  url.password = tenantLoginPassword(schema);
  return url.toString();
}

/** The pool tenant statements run on: the business's own login, or the broker without the secret. */
export function tenantPool(schema: string): pg.Pool {
  return tenantLoginsEnabled() ? getLoginPool(tenantConnectionString(schema)) : getPool('tenant');
}

/**
 * Creates (or refreshes the password of) a business's login. Runs as the admin role, which created
 * the business's roles and so administers them. Idempotent.
 */
export async function ensureTenantLogin(schema: string, client?: pg.PoolClient): Promise<void> {
  const names = tenantNames(schema);
  const own = client ?? (await getPool('admin').connect());
  const login = ident(names.loginRole);
  const pw = own.escapeLiteral(tenantLoginPassword(schema));
  try {
    if (!client) await own.query('BEGIN');
    const exists = await own.query('select 1 from pg_roles where rolname = $1', [names.loginRole]);
    await own.query(
      exists.rowCount
        ? `ALTER ROLE ${login} WITH LOGIN CONNECTION LIMIT 10 PASSWORD ${pw}`
        : `CREATE ROLE ${login} WITH LOGIN NOCREATEROLE NOCREATEDB CONNECTION LIMIT 10 PASSWORD ${pw}`,
    );
    // It may become the business's roles but doesn't hold their rights by default.
    await own.query(
      `GRANT ${ident(names.readerRole)}, ${ident(names.writerRole)} TO ${login} WITH INHERIT FALSE, SET TRUE`,
    );
    // CONNECT (and set_config where it's locked) come from the group.
    await own.query(
      `GRANT ${ident(loginGroupName(brokerName()))} TO ${login} WITH INHERIT TRUE, SET FALSE`,
    );
    if (!client) await own.query('COMMIT');
  } catch (err) {
    if (!client) await own.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (!client) own.release();
  }
  await forgetLoginPool(names.loginRole);
}

/** Removes a business's login (when the business is deleted). */
export async function dropTenantLogin(client: pg.PoolClient, schema: string): Promise<void> {
  const names = tenantNames(schema);
  await client.query(`DROP ROLE IF EXISTS ${ident(names.loginRole)}`);
  await forgetLoginPool(names.loginRole);
}

/** The broker no longer needs to be a member of this business's roles once it has its own login. */
export async function revokeBroker(client: pg.PoolClient, schema: string): Promise<void> {
  const names = tenantNames(schema);
  await client.query(
    `REVOKE ${ident(names.readerRole)}, ${ident(names.writerRole)} FROM ${ident(brokerName())}`,
  );
}

function sqlState(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  return typeof err.code === 'string' ? err.code : undefined;
}

/**
 * A connection for one business's statements. A business made before per-business logins were
 * switched on (or after the secret changed) gets its login made or refreshed once, then it retries.
 */
export async function connectTenant(schema: string): Promise<pg.PoolClient> {
  try {
    return await tenantPool(schema).connect();
  } catch (err) {
    // 28P01: wrong password; 28000: no such login.
    if (!tenantLoginsEnabled() || !['28P01', '28000'].includes(sqlState(err) ?? '')) throw err;
    getLogger('tenancy').warn({ schema, code: sqlState(err) }, 'refreshing business login');
    await ensureTenantLogin(schema);
    return tenantPool(schema).connect();
  }
}
