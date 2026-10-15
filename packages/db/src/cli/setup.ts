/**
 * `pnpm db:setup` — creates the login roles and base privileges. Idempotent; safe to re-run.
 * Runs as a superuser (DATABASE_URL_SUPERUSER). Local dev and CI only; hosted stages set roles up
 * through the provider's console using the same SQL.
 */
import { getEnv } from '@bizr/platform';
import pg from 'pg';

import { loginRoles } from './roles';

async function main() {
  const env = getEnv();
  if (!env.DATABASE_URL_SUPERUSER) throw new Error('DATABASE_URL_SUPERUSER is required');
  const roles = loginRoles(env);
  const client = new pg.Client({ connectionString: env.DATABASE_URL_SUPERUSER });
  await client.connect();
  try {
    const db = client.escapeIdentifier(new URL(env.DATABASE_URL_SUPERUSER).pathname.slice(1));
    const id = (name: string) => client.escapeIdentifier(name);
    const lit = (value: string) => client.escapeLiteral(value);

    const ensureRole = async (name: string, password: string, attrs: string) => {
      const exists = await client.query('select 1 from pg_roles where rolname = $1', [name]);
      const verb = exists.rowCount ? 'ALTER' : 'CREATE';
      await client.query(`${verb} ROLE ${id(name)} WITH LOGIN ${attrs} PASSWORD ${lit(password)}`);
    };

    await client.query('BEGIN');
    await ensureRole(roles.owner.name, roles.owner.password, 'NOSUPERUSER NOCREATEROLE INHERIT');
    await ensureRole(roles.app.name, roles.app.password, 'NOSUPERUSER NOCREATEROLE INHERIT');
    // CREATEROLE: provisions per-tenant roles (PG16+: it can only manage roles it created).
    await ensureRole(roles.admin.name, roles.admin.password, 'NOSUPERUSER CREATEROLE INHERIT');
    // NOINHERIT + no privileges of its own: it must SET ROLE to a tenant role to see anything.
    await ensureRole(
      roles.tenant.name,
      roles.tenant.password,
      'NOSUPERUSER NOCREATEROLE NOINHERIT',
    );

    // Nobody connects or creates by default; grant explicitly.
    await client.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    for (const r of [roles.owner, roles.app, roles.admin, roles.tenant]) {
      await client.query(`GRANT CONNECT ON DATABASE ${db} TO ${id(r.name)}`);
    }
    // Owner creates the `app` schema (migrations); admin creates tenant schemas.
    await client.query(
      `GRANT CREATE ON DATABASE ${db} TO ${id(roles.owner.name)}, ${id(roles.admin.name)}`,
    );

    // Tenant roles must not be able to change session settings, above all `role` (which could switch
    // to another tenant's role via set_config). Only our own login roles may call set_config; the
    // safe executor sets everything it needs *before* SET LOCAL ROLE. (ARCHITECTURE §6)
    await client.query(
      'REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) FROM PUBLIC',
    );
    await client.query(
      `GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean)
         TO ${[roles.owner, roles.app, roles.admin, roles.tenant].map((r) => id(r.name)).join(', ')}`,
    );

    // Job queue schema, owned by the control-plane role (pg-boss manages its own tables).
    await client.query(`CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION ${id(roles.app.name)}`);

    // Tables the owner creates in `app` are usable by app and admin (never by tenant roles).
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${id(roles.owner.name)}
         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${id(roles.app.name)}, ${id(roles.admin.name)}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${id(roles.owner.name)}
         GRANT USAGE, SELECT ON SEQUENCES TO ${id(roles.app.name)}, ${id(roles.admin.name)}`,
    );
    await client.query('COMMIT');
    console.log(
      `Database roles ready: ${Object.values(roles)
        .map((r) => r.name)
        .join(', ')}`,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
