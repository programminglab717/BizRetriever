/**
 * `pnpm --filter @bizr/worker run snapshot:gc` queues `snapshot.gc` (drops backups older than 30 days).
 * Run daily; the platform cron arrives with M7 (ARCHITECTURE §11).
 */
import { createDefaultRegistry, JobQueue } from '@bizr/core/jobs';
import { snapshotGcJob } from '@bizr/core/structure';
import { closePools } from '@bizr/db';

const queue = await JobQueue.start({ registry: createDefaultRegistry(), supervise: false });
console.log(await queue.enqueue(snapshotGcJob, {}));
await queue.stop();
await closePools();
