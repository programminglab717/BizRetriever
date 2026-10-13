/** Dev helper: `pnpm --filter @bizr/worker enqueue:noop [ticks]` queues a test job and prints its id. */
import { createDefaultRegistry, JobQueue, noopJob } from '@bizr/core/jobs';
import { closePools } from '@bizr/db';

const ticks = Number(process.argv[2] ?? 3);
const queue = await JobQueue.start({ registry: createDefaultRegistry(), supervise: false });
const runId = await queue.enqueue(noopJob, { ticks, tickMs: 200 });
console.log(runId);
await queue.stop();
await closePools();
