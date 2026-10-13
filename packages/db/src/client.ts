import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

import { getPool } from './pools';
import * as schema from './schema';

export type AppDb = NodePgDatabase<typeof schema>;

let appDb: AppDb | undefined;

/** Drizzle client for the control plane (`app` schema), connected as `bizr_app`. */
export function getAppDb(): AppDb {
  appDb ??= drizzle(getPool('app'), { schema });
  return appDb;
}
