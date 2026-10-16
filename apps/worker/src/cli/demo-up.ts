/**
 * `pnpm demo:up` — the demo machine in one command (PLAN M8, DEMO_SCRIPT §1).
 *
 *   1. Postgres: uses the one in .env; if it isn't answering, starts `docker compose` and waits.
 *   2. Roles and migrations (idempotent).
 *   3. The demo sign-in (DEMO_EMAIL / DEMO_PASSWORD; a fresh password is made and shown if unset).
 *   4. Resets the demo shops: tab A, an empty "Fernwood Home & Gift" for the live upload, and tab B,
 *      the same shop already imported (with insights), in case the live import has trouble.
 *   5. Writes today's messy files to `demo-files/Fernwood files/` (and next month's export).
 *   6. Starts the web app and the worker with AI in replay mode (recordings only, no live calls).
 *
 * Flags: `--no-start` (reset only), `--build` (build the web app first), `--live-ai` (keep the
 * AI mode from .env).
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  demoFiles,
  demoNextMonthFile,
  demoToday,
  finishDemoImport,
  startDemoShop,
} from '@bizr/core/demo';
import { createDefaultRegistry, JobQueue } from '@bizr/core/jobs';
import { createWorkspace } from '@bizr/core/workspaces';
import { account, closePools, getAppDb, insight, user, workspace } from '@bizr/db';
import { findRepoRoot, getEnv } from '@bizr/platform';
import { hashPassword } from 'better-auth/crypto';
import { desc, eq } from 'drizzle-orm';
import pg from 'pg';

const args = new Set(process.argv.slice(2));
const root = findRepoRoot();
const say = (msg: string) => process.stdout.write(`${msg}\n`);
const run = (cmd: string, cmdArgs: string[], env: NodeJS.ProcessEnv = {}) =>
  execFileSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });

async function postgresAnswers(url: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

async function ensurePostgres(url: string) {
  if (await postgresAnswers(url)) return;
  say('Postgres isn’t answering; starting it with docker compose…');
  try {
    run('docker', ['compose', 'up', '-d', '--wait']);
  } catch {
    throw new Error(
      'Could not start Postgres. Start it yourself (`docker compose up -d`) and retry.',
    );
  }
  for (let i = 0; i < 30 && !(await postgresAnswers(url)); i++)
    await new Promise((r) => setTimeout(r, 1_000));
  if (!(await postgresAnswers(url))) throw new Error('Postgres didn’t come up in 30 seconds.');
}

/** The demo person, with a password sign-in (Better Auth's own hash, so the app accepts it). */
async function ensureDemoUser(email: string, password: string): Promise<string> {
  const db = getAppDb();
  const hash = await hashPassword(password);
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  const id =
    existing?.id ??
    (
      await db
        .insert(user)
        .values({ name: 'Avery Demo', email, emailVerified: true })
        .returning({ id: user.id })
    )[0]!.id;
  const [cred] = await db.select({ id: account.id }).from(account).where(eq(account.userId, id));
  if (cred)
    await db
      .update(account)
      .set({ password: hash, updatedAt: new Date() })
      .where(eq(account.id, cred.id));
  else
    await db
      .insert(account)
      .values({ userId: id, accountId: id, providerId: 'credential', password: hash });
  return id;
}

function writeFolder(dir: string, files: { fileName: string; bytes: Uint8Array }[]) {
  mkdirSync(dir, { recursive: true });
  for (const f of files) writeFileSync(path.join(dir, f.fileName), f.bytes);
}

async function main() {
  const env = getEnv();
  await ensurePostgres(env.DATABASE_URL_APP);
  say('Setting up the database…');
  run('pnpm', ['--silent', 'db:setup']);
  run('pnpm', ['--silent', 'db:migrate']);

  const password = env.DEMO_PASSWORD ?? `fernwood-${crypto.randomUUID().slice(0, 8)}`;
  const userId = await ensureDemoUser(env.DEMO_EMAIL, password);

  const today = demoToday();
  say(`Resetting the demo shops for ${today}…`);
  const queue = await JobQueue.start({ registry: createDefaultRegistry(), supervise: false });
  let live: string;
  let ready: string;
  try {
    // Tab B first (starting a demo shop clears this person's old ones), then tab A.
    const b = await startDemoShop({ userId, queue, name: 'Fernwood Home & Gift' });
    await finishDemoImport({ member: b.member, userId, runId: b.runId, queue });
    ready = b.member.workspace.slug;
    const a = await createWorkspace(
      userId,
      {
        name: 'Fernwood Home & Gift',
        packId: 'retail',
        currency: 'USD',
        timezone: 'America/New_York',
        dateOrder: 'MDY',
      },
      { isDemo: true },
    );
    live = a.slug;
  } finally {
    await queue.stop();
  }

  const folder = path.join(root, 'demo-files');
  rmSync(folder, { recursive: true, force: true });
  const { files, truth } = await demoFiles({ today });
  writeFolder(path.join(folder, 'Fernwood files'), files);
  writeFolder(path.join(folder, 'Next month'), (await demoNextMonthFile({ today })).files);
  // Today's numbers for the script (DEMO_SCRIPT §2 reads these out).
  const said = await getAppDb()
    .select({ text: insight.text })
    .from(insight)
    .innerJoin(workspace, eq(workspace.id, insight.workspaceId))
    .where(eq(workspace.slug, ready))
    .orderBy(desc(insight.score))
    .limit(8);
  await closePools();
  const c = truth.counts as Record<string, number>;
  const fmt = (n: number | undefined) => new Intl.NumberFormat('en-US').format(n ?? 0);

  const url = env.APP_URL;
  say('');
  say('The demo is ready.');
  say(`  Sign in:  ${url}/sign-in  as ${env.DEMO_EMAIL} / ${password}`);
  say(`  Tab A (live upload):  ${url}/w/${live}/data/import`);
  say(`  Tab B (already in):   ${url}/w/${ready}/home`);
  say(`  Files to drag in:     ${path.join(folder, 'Fernwood files')}`);
  say(`  Next month's export:  ${path.join(folder, 'Next month')}`);
  say('');
  say(
    `Today's numbers: ${fmt(c.products)} products, ${fmt(c.sales)} sales, ${fmt(c.namedCustomers)} named customers.`,
  );
  say('What Home will say (most important first):');
  for (const s of said) say(`  - ${s.text}`);
  say('');

  if (args.has('--no-start')) return;
  if (args.has('--build') || !existsSync(path.join(root, 'apps/web/.next/BUILD_ID'))) {
    say('Building the web app (once)…');
    run('pnpm', ['--silent', 'build']);
  }
  const shared: NodeJS.ProcessEnv = {
    ...process.env,
    JOB_RUNNER: 'worker',
    ...(args.has('--live-ai') ? {} : { AI_REPLAY_MODE: 'replay' }),
  };
  const children: ChildProcess[] = [
    spawn('pnpm', ['--silent', 'start'], { cwd: root, stdio: 'inherit', env: shared }),
    spawn('pnpm', ['--silent', 'start:worker'], { cwd: root, stdio: 'inherit', env: shared }),
  ];
  const stop = () => {
    for (const c of children) c.kill('SIGTERM');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  say('Web and worker are starting. Press Ctrl-C to stop both.');
  await Promise.all(children.map((c) => new Promise((r) => c.on('exit', r))));
}

main().catch(async (err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  await closePools().catch(() => {});
  process.exit(1);
});
