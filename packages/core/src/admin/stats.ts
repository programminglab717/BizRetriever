import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { getAppDb } from '@bizr/db';
import { findRepoRoot, getEnv } from '@bizr/platform';
import { sql } from 'drizzle-orm';

/**
 * The internal admin page (PLAN M8): AI spend per workspace and against the caps (ADR-027), AI
 * latency and how often outputs failed validation, query latency by origin, job failures and the
 * eval baselines. Control-plane reads only; no tenant data.
 */

export function isAdmin(email: string): boolean {
  const allowed = getEnv()
    .ADMIN_EMAILS.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

export interface AdminOverview {
  spend: { todayUsd: string; monthUsd: string; dailyCapUsd: number; monthlyCapUsd: number };
  byWorkspace: { workspace: string; calls: number; costUsd: string; lastCall: Date | null }[];
  byTask: {
    task: string;
    calls: number;
    ok: number;
    replayed: number;
    invalid: number;
    failed: number;
    blocked: number;
    p50Ms: number | null;
    p95Ms: number | null;
  }[];
  queries: {
    origin: string;
    path: string;
    runs: number;
    errors: number;
    p50Ms: number | null;
    p95Ms: number | null;
    maxMs: number | null;
  }[];
  jobs: { job: string; runs: number; failed: number }[];
  baselines: { suite: string; metrics: Record<string, number> }[];
  sinceDays: number;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)));

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const r = await getAppDb().execute(query);
  return r.rows as T[];
}

export function evalBaselines(): AdminOverview['baselines'] {
  const dir = path.join(findRepoRoot(), 'evals', 'baselines');
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => {
        const data = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as {
          rules?: Record<string, number>;
        };
        return { suite: f.replace(/\.json$/, ''), metrics: data.rules ?? {} };
      });
  } catch {
    return [];
  }
}

export async function adminOverview(options: { sinceDays?: number } = {}): Promise<AdminOverview> {
  const days = options.sinceDays ?? 30;
  const since = new Date(Date.now() - days * 86_400_000);
  const week = new Date(Date.now() - 7 * 86_400_000);
  const env = getEnv();

  const [spend] = await rows<{ today: string; month: string }>(sql`
    SELECT coalesce(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0)::text AS today,
           coalesce(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0)::text AS month
    FROM app.ai_call`);

  const byWorkspace = await rows<{
    workspace: string | null;
    calls: string;
    cost: string;
    last: Date | null;
  }>(sql`
    SELECT w.name AS workspace, count(*)::text AS calls, coalesce(sum(a.cost_usd), 0)::text AS cost,
           max(a.created_at) AS last
    FROM app.ai_call a LEFT JOIN app.workspace w ON w.id = a.workspace_id
    WHERE a.created_at >= ${since}
    GROUP BY w.name ORDER BY sum(a.cost_usd) DESC NULLS LAST, count(*) DESC LIMIT 20`);

  const byTask = await rows<Record<string, string | null>>(sql`
    SELECT task, count(*) AS calls,
           count(*) FILTER (WHERE status = 'ok') AS ok,
           count(*) FILTER (WHERE status = 'replayed') AS replayed,
           count(*) FILTER (WHERE status = 'invalid_output') AS invalid,
           count(*) FILTER (WHERE status IN ('error', 'refused')) AS failed,
           count(*) FILTER (WHERE status IN ('budget_blocked', 'unavailable')) AS blocked,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
    FROM app.ai_call WHERE created_at >= ${since}
    GROUP BY task ORDER BY task`);

  const queries = await rows<Record<string, string | null>>(sql`
    SELECT origin, path, count(*) AS runs, count(*) FILTER (WHERE error IS NOT NULL) AS errors,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
           max(duration_ms) AS max
    FROM app.query_run WHERE created_at >= ${week}
    GROUP BY origin, path ORDER BY origin, path`);

  const jobs = await rows<Record<string, string>>(sql`
    SELECT job_name AS job, count(*) AS runs, count(*) FILTER (WHERE status = 'failed') AS failed
    FROM app.job_run WHERE created_at >= ${week}
    GROUP BY job_name ORDER BY job_name`);

  return {
    spend: {
      todayUsd: spend?.today ?? '0',
      monthUsd: spend?.month ?? '0',
      dailyCapUsd: env.AI_BUDGET_DAILY_USD,
      monthlyCapUsd: env.AI_BUDGET_MONTHLY_USD,
    },
    byWorkspace: byWorkspace.map((r) => ({
      workspace: r.workspace ?? '(no business)',
      calls: Number(r.calls),
      costUsd: r.cost,
      lastCall: r.last,
    })),
    byTask: byTask.map((r) => ({
      task: String(r.task),
      calls: Number(r.calls),
      ok: Number(r.ok),
      replayed: Number(r.replayed),
      invalid: Number(r.invalid),
      failed: Number(r.failed),
      blocked: Number(r.blocked),
      p50Ms: num(r.p50),
      p95Ms: num(r.p95),
    })),
    queries: queries.map((r) => ({
      origin: String(r.origin),
      path: String(r.path),
      runs: Number(r.runs),
      errors: Number(r.errors),
      p50Ms: num(r.p50),
      p95Ms: num(r.p95),
      maxMs: num(r.max),
    })),
    jobs: jobs.map((r) => ({ job: r.job!, runs: Number(r.runs), failed: Number(r.failed) })),
    baselines: evalBaselines(),
    sinceDays: days,
  };
}
