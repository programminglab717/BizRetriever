/**
 * `pnpm preview:check` — is this configuration ready to run as the free hosted preview (Stage 1,
 * ADR-016, docs/RUNBOOK_PREVIEW.md)? Run it with the preview's environment variables set (for
 * example `vercel env pull`, then `pnpm preview:check`). It changes nothing: every database probe
 * runs in a transaction that is rolled back.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { loginGroupName } from '@bizr/db';
import { findRepoRoot, getEnv } from '@bizr/platform';
import pg from 'pg';

let failed = 0;
const ok = (msg: string) => process.stdout.write(`  ✓ ${msg}\n`);
const bad = (msg: string) => {
  failed += 1;
  process.stdout.write(`  ✗ ${msg}\n`);
};
const note = (msg: string) => process.stdout.write(`  ! ${msg}\n`);
const check = (cond: boolean, good: string, problem: string) => (cond ? ok(good) : bad(problem));

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function main() {
  const env = getEnv();
  process.stdout.write('Settings\n');
  check(
    env.APP_URL.startsWith('https://'),
    `APP_URL is ${env.APP_URL}`,
    'APP_URL must be the https:// address of the preview',
  );
  check(
    !!env.BETTER_AUTH_SECRET,
    'BETTER_AUTH_SECRET is set',
    'BETTER_AUTH_SECRET is missing (openssl rand -hex 32)',
  );
  check(
    env.JOB_RUNNER === 'inline',
    'JOB_RUNNER=inline (no worker server)',
    'JOB_RUNNER must be inline on the free preview',
  );
  check(
    !!env.JOB_DRAIN_SECRET,
    'JOB_DRAIN_SECRET is set (also set CRON_SECRET to the same value)',
    'JOB_DRAIN_SECRET is missing: the daily cron and job draining need it',
  );
  check(
    env.STORAGE_DRIVER === 'postgres',
    'STORAGE_DRIVER=postgres',
    'STORAGE_DRIVER must be postgres (serverless disks are temporary)',
  );
  check(
    env.JOB_STEP_BUDGET_MS <= 45_000,
    `JOB_STEP_BUDGET_MS=${env.JOB_STEP_BUDGET_MS}`,
    'JOB_STEP_BUDGET_MS should stay under the host’s function time limit',
  );
  if (env.TENANT_LOGIN_SECRET) ok('per-business database logins are on (TENANT_LOGIN_SECRET)');
  else
    note(
      'TENANT_LOGIN_SECRET is not set: every business shares one database login (demo data only)',
    );
  if (!env.ANTHROPIC_API_KEY)
    note('No ANTHROPIC_API_KEY: the preview runs on rules only (fine for the demo)');
  else
    note(
      `AI is on, capped at $${env.AI_BUDGET_DAILY_USD}/day and $${env.AI_BUDGET_MONTHLY_USD}/month`,
    );
  const urls = {
    DATABASE_URL_MIGRATE: env.DATABASE_URL_MIGRATE,
    DATABASE_URL_APP: env.DATABASE_URL_APP,
    DATABASE_URL_ADMIN: env.DATABASE_URL_ADMIN,
    DATABASE_URL_TENANT: env.DATABASE_URL_TENANT,
  };
  for (const [name, url] of Object.entries(urls)) {
    if (!url) {
      bad(`${name} is missing`);
      continue;
    }
    const u = new URL(url);
    check(
      u.searchParams.get('sslmode') === 'require' || u.hostname === 'localhost',
      `${name} uses TLS`,
      `${name} should end with ?sslmode=require`,
    );
  }

  process.stdout.write('Database\n');
  for (const [name, url] of Object.entries(urls)) {
    if (!url) continue;
    try {
      const who = await withClient(
        url,
        async (c) => (await c.query<{ u: string }>('select current_user as u')).rows[0]!.u,
      );
      ok(`${name} connects as ${who}`);
    } catch (err) {
      bad(`${name} can't connect: ${(err as Error).message}`);
    }
  }
  if (env.DATABASE_URL_MIGRATE) {
    try {
      const journal = JSON.parse(
        readFileSync(
          path.join(findRepoRoot(), 'packages/db/migrations/meta/_journal.json'),
          'utf8',
        ),
      ) as { entries: unknown[] };
      const applied = await withClient(env.DATABASE_URL_MIGRATE, async (c) =>
        Number(
          (await c.query<{ n: string }>('select count(*) as n from drizzle.__drizzle_migrations'))
            .rows[0]!.n,
        ),
      );
      check(
        applied >= journal.entries.length,
        `migrations applied (${applied})`,
        `migrations behind: ${applied} of ${journal.entries.length} (run pnpm db:migrate)`,
      );
    } catch (err) {
      bad(
        `couldn't read the migrations: ${(err as Error).message} (run pnpm db:setup and pnpm db:migrate)`,
      );
    }
  }
  if (env.DATABASE_URL_APP) {
    await withClient(env.DATABASE_URL_APP, async (c) => {
      const r = await c.query(
        "select 1 from information_schema.schemata where schema_name = 'pgboss'",
      );
      check(
        r.rowCount === 1,
        'job queue schema exists',
        'pgboss schema missing (run pnpm db:setup)',
      );
    }).catch((err: Error) => bad(`job queue check failed: ${err.message}`));
  }
  if (env.DATABASE_URL_ADMIN) {
    await withClient(env.DATABASE_URL_ADMIN, async (c) => {
      await c.query('BEGIN');
      try {
        await c.query('CREATE ROLE bizr_preview_probe NOLOGIN');
        await c.query('CREATE SCHEMA bizr_preview_probe');
        // A business's own login (ADR-055), with CONNECT through the logins group.
        const group = loginGroupName(decodeURIComponent(new URL(env.DATABASE_URL_TENANT).username));
        await c.query('CREATE ROLE bizr_preview_probe_login LOGIN');
        await c.query(
          'GRANT bizr_preview_probe TO bizr_preview_probe_login WITH INHERIT FALSE, SET TRUE',
        );
        await c.query(`GRANT ${c.escapeIdentifier(group)} TO bizr_preview_probe_login`);
        ok('the admin role can make a new business with its own login (rolled back)');
      } catch (err) {
        bad(`the admin role can't make a new business: ${(err as Error).message}`);
      } finally {
        await c.query('ROLLBACK');
      }
      const open = await c.query<{ open: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           WHERE p.oid = 'pg_catalog.set_config(text, text, boolean)'::regprocedure
             AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS open`,
      );
      if (!open.rows[0]?.open) ok('set_config is locked to our own roles');
      else if (env.TENANT_LOGIN_SECRET)
        ok(
          'set_config is open (no superuser on this host), but each business’s own login can only become its own roles (ADR-055)',
        );
      else
        note(
          'set_config is open to every role (no superuser on this host) and the login is shared: demo data only (ADR-054). Set TENANT_LOGIN_SECRET for real data.',
        );
    }).catch((err: Error) => bad(`admin checks failed: ${err.message}`));
  }

  process.stdout.write(failed ? `\n${failed} problem(s) to fix.\n` : '\nReady for the preview.\n');
  process.exit(failed ? 1 : 0);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
