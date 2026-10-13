import { timingSafeEqual } from 'node:crypto';

import { getEnv, getLogger, withLogContext } from '@bizr/platform';

import { getJobQueue } from '@/lib/jobs';

/**
 * Serverless job processing for the free hosted preview (ADR-011, `JOB_RUNNER=inline`).
 * Called by the UI while a user waits on a job, and by a daily platform cron (`?maintenance=1`).
 * Requires `Authorization: Bearer <JOB_DRAIN_SECRET>`; disabled when the secret is not set.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request: Request, secret: string): boolean {
  const header = request.headers.get('authorization') ?? '';
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function handle(request: Request): Promise<Response> {
  const env = getEnv();
  if (!env.JOB_DRAIN_SECRET) {
    return Response.json({ error: 'Job draining is not enabled' }, { status: 503 });
  }
  if (!authorized(request, env.JOB_DRAIN_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const maintenance = new URL(request.url).searchParams.get('maintenance') === '1';
  return withLogContext({}, async () => {
    const queue = await getJobQueue();
    const summary = await queue.drain({ budgetMs: env.JOB_STEP_BUDGET_MS, maintenance });
    getLogger('jobs').info({ summary, maintenance }, 'drain finished');
    return Response.json(summary, { headers: { 'cache-control': 'no-store' } });
  });
}

// GET is what platform crons send; POST is what our UI sends.
export const GET = handle;
export const POST = handle;
