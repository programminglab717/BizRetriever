import pg from 'pg';

import { getEnv } from '../env';

/**
 * Integration tests need the test database (`.env.test.local` locally, service container in CI).
 * Locally they are skipped with a warning when it isn't reachable; with REQUIRE_DB_TESTS=1 (CI)
 * a missing database fails the run instead of silently skipping.
 */
export async function databaseAvailable(): Promise<boolean> {
  let ok: boolean;
  try {
    const client = new pg.Client({ connectionString: getEnv().DATABASE_URL_APP });
    await client.connect();
    await client.end();
    ok = true;
  } catch {
    ok = false;
  }
  if (!ok && process.env.REQUIRE_DB_TESTS === '1') {
    throw new Error('REQUIRE_DB_TESTS=1 but the test database is not reachable');
  }
  if (!ok) console.warn('[tests] test database not reachable; skipping integration tests');
  return ok;
}
