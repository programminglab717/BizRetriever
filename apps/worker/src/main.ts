/**
 * Background worker (ADR-011, `JOB_RUNNER=worker`). Subscribes to every job queue and runs
 * pg-boss maintenance. In the free hosted preview there is no worker; the drain route is used.
 */
import { scheduleDailyJobs } from '@bizr/core/insights';
import { createDefaultRegistry, JobQueue } from '@bizr/core/jobs';
import { closePools } from '@bizr/db';
import { getEnv, getLogger } from '@bizr/platform';

// In worker mode a run may use much longer than a serverless step budget before yielding.
const WORKER_BUDGET_MS = 5 * 60_000;
// The daily jobs are queued at most once per day; checking hourly catches restarts and new days.
const DAILY_CHECK_MS = 60 * 60_000;

async function main() {
  const env = getEnv();
  const log = getLogger('worker');
  if (env.JOB_RUNNER !== 'worker') {
    log.warn({ jobRunner: env.JOB_RUNNER }, 'JOB_RUNNER is not "worker"; starting anyway');
  }

  const registry = createDefaultRegistry();
  const queue = await JobQueue.start({ registry, supervise: true });
  await queue.work({ budgetMs: WORKER_BUDGET_MS });
  log.info({ queues: registry.names() }, 'worker started');

  const daily = async () => {
    try {
      const queued = await scheduleDailyJobs(queue);
      if (queued.length) log.info({ queued }, 'daily jobs queued');
    } catch (err) {
      log.error({ err }, 'queueing daily jobs failed');
    }
  };
  await daily();
  const timer = setInterval(() => void daily(), DAILY_CHECK_MS);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'worker stopping');
    clearInterval(timer);
    await queue.stop();
    await closePools();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  getLogger('worker').fatal({ err }, 'worker failed to start');
  process.exit(1);
});
