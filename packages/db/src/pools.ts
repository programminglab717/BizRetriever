import { getEnv, getLogger } from '@bizr/platform';
import pg from 'pg';

/**
 * One pool per database role (ARCHITECTURE §6):
 * - `app`    control plane only; has no privileges on tenant schemas.
 * - `admin`  owns tenant schemas; used only by provisioning, change-plan apply, loads and merges.
 * - `tenant` broker role for the safe executor; must `SET LOCAL ROLE t_<id>_reader|writer`.
 */
export type DbRole = 'app' | 'admin' | 'tenant';

const pools = new Map<DbRole, pg.Pool>();

function urlFor(role: DbRole): string {
  const env = getEnv();
  switch (role) {
    case 'app':
      return env.DATABASE_URL_APP;
    case 'admin':
      return env.DATABASE_URL_ADMIN;
    case 'tenant':
      return env.DATABASE_URL_TENANT;
  }
}

export function getPool(role: DbRole): pg.Pool {
  let pool = pools.get(role);
  if (!pool) {
    pool = new pg.Pool({
      connectionString: urlFor(role),
      max: role === 'app' ? 10 : 5,
      idleTimeoutMillis: 30_000,
      application_name: `bizr_${role}`,
    });
    const log = getLogger('db');
    pool.on('error', (err) => log.error({ err, role }, 'idle database client error'));
    pools.set(role, pool);
  }
  return pool;
}

/**
 * Small pools for other logins (one per business with per-business logins, ADR-055), kept for the
 * most recently used ones only.
 */
const loginPools = new Map<string, pg.Pool>();
const MAX_LOGIN_POOLS = 32;

export function getLoginPool(connectionString: string): pg.Pool {
  const user = decodeURIComponent(new URL(connectionString).username);
  let pool = loginPools.get(user);
  if (pool) {
    // Most recently used last.
    loginPools.delete(user);
    loginPools.set(user, pool);
    return pool;
  }
  pool = new pg.Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    application_name: 'bizr_tenant_login',
  });
  const log = getLogger('db');
  pool.on('error', (err) => log.error({ err, user }, 'idle database client error'));
  loginPools.set(user, pool);
  while (loginPools.size > MAX_LOGIN_POOLS) {
    const [oldest, old] = loginPools.entries().next().value as [string, pg.Pool];
    loginPools.delete(oldest);
    void old.end();
  }
  return pool;
}

/** Drops a login's pool (after its password changes, or the business is deleted). */
export async function forgetLoginPool(user: string): Promise<void> {
  const pool = loginPools.get(user);
  loginPools.delete(user);
  await pool?.end();
}

export async function closePools(): Promise<void> {
  const all = [...pools.values(), ...loginPools.values()];
  pools.clear();
  loginPools.clear();
  await Promise.all(all.map((p) => p.end()));
}

/** Cheap connectivity check used by the health endpoint. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await getPool('app').query('select 1');
    return true;
  } catch {
    return false;
  }
}
