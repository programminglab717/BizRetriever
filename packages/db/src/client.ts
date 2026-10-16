import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

import { getPool } from './pools';
import * as schema from './schema';

export type AppDb = NodePgDatabase<typeof schema>;

let appDb: { db: AppDb; pool: ReturnType<typeof getPool> } | undefined;

/** Drizzle client for the control plane (`app` schema), connected as `bizr_app`. */
export function getAppDb(): AppDb {
  // A new pool after `closePools()` (scripts that run several suites) gets a new client.
  const pool = getPool('app');
  if (appDb?.pool !== pool) appDb = { db: drizzle(pool, { schema }), pool };
  return appDb.db;
}
