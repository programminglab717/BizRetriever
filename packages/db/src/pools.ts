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

export async function closePools(): Promise<void> {
  const all = [...pools.values()];
  pools.clear();
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
