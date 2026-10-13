import 'server-only';

import { createDefaultRegistry, JobQueue } from '@bizr/core/jobs';

// Reuse one queue per server process (and across dev hot reloads).
const globalForJobs = globalThis as typeof globalThis & { bizrJobQueue?: Promise<JobQueue> };

export function getJobQueue(): Promise<JobQueue> {
  globalForJobs.bizrJobQueue ??= JobQueue.start({
    registry: createDefaultRegistry(),
    // The web app never runs pg-boss maintenance timers; the worker (or the daily drain) does.
    supervise: false,
  }).catch((err: unknown) => {
    globalForJobs.bizrJobQueue = undefined;
    throw err;
  });
  return globalForJobs.bizrJobQueue;
}
