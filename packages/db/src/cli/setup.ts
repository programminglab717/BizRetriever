/**
 * `pnpm db:setup` — creates the login roles and base privileges. Idempotent; safe to re-run.
 * Runs as DATABASE_URL_SUPERUSER: a real superuser locally and in CI, or on managed Postgres (Neon,
 * Stage 1) the console-created owner role, which has CREATEROLE but isn't a superuser. In that case
 * it gives itself membership of the roles it creates (needed to hand them schemas and default
 * privileges) and does without the one superuser-only step, reporting it (ADR-054).
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

    const [me] = (
      await client.query<{ super: boolean }>(
        'select rolsuper as super from pg_roles where rolname = current_user',
      )
    ).rows;
    const managed = !me?.super;
    const warnings: string[] = [];

    const ensureRole = async (name: string, password: string, attrs: string) => {
      const exists = await client.query('select 1 from pg_roles where rolname = $1', [name]);
      const verb = exists.rowCount ? 'ALTER' : 'CREATE';
      // Only a superuser may even restate NOSUPERUSER; new roles are never superusers anyway.
      const allowed = managed ? attrs.replace('NOSUPERUSER ', '') : attrs;
      await client.query(
        `${verb} ROLE ${id(name)} WITH LOGIN ${allowed} PASSWORD ${lit(password)}`,
      );
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

    if (managed) {
      // Postgres 16+: a CREATEROLE role administers the roles it creates but isn't a member of them.
      // It needs SET (to give them schemas) and INHERIT (to set their default privileges).
      for (const r of [roles.owner, roles.app, roles.admin])
        await client.query(`GRANT ${id(r.name)} TO CURRENT_USER WITH INHERIT TRUE, SET TRUE`);
    }

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
    // Changing a built-in function's privileges needs a real superuser. Without one (managed
    // Postgres), tenant SQL still can't reach set_config: the SQL validator only allows listed
    // functions, and everything else runs through typed specs (ARCHITECTURE §6).
    // A non-owner's REVOKE is only a warning in Postgres, so check the result rather than trust it.
    await client.query(
      'REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) FROM PUBLIC',
    );
    await client.query(
      `GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean)
         TO ${[roles.owner, roles.app, roles.admin, roles.tenant].map((r) => id(r.name)).join(', ')}`,
    );
    const [open] = (
      await client.query<{ open: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           WHERE p.oid = 'pg_catalog.set_config(text, text, boolean)'::regprocedure
             AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS open`,
      )
    ).rows;
    if (open?.open) {
      if (!managed) throw new Error('Could not take set_config away from PUBLIC');
      warnings.push(
        'set_config stays callable by every role (changing it needs a real superuser). The SQL ' +
          'validator still blocks it in tenant SQL.',
      );
    }

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
    for (const w of warnings) console.warn(`Note: ${w}`);
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
