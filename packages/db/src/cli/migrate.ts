/** `pnpm db:migrate` — applies control-plane migrations as the schema owner, then grants. */
import { fileURLToPath } from 'node:url';

import { getEnv } from '@bizr/platform';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { loginRoles } from './roles';

async function main() {
  const env = getEnv();
  const roles = loginRoles(env);
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL_MIGRATE, max: 1 });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: fileURLToPath(new URL('../../migrations', import.meta.url)),
    });
    const client = await pool.connect();
    try {
      const app = client.escapeIdentifier(roles.app.name);
      const admin = client.escapeIdentifier(roles.admin.name);
      await client.query(`GRANT USAGE ON SCHEMA app TO ${app}, ${admin}`);
      await client.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO ${app}, ${admin}`,
      );
      await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO ${app}, ${admin}`);
    } finally {
      client.release();
    }
    console.log('Control-plane migrations applied.');
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
