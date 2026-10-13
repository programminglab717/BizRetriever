export {
  defineJob,
  JobRegistry,
  type AnyJobDefinition,
  type JobDefinition,
  type JobStep,
  type StepContext,
  type StepOutcome,
} from './define';
export { JobQueue, type DrainSummary, type JobQueueOptions } from './queue';
export { advanceRun, type AdvanceResult, type AdvanceStatus } from './runner';
export { noopJob } from './system-jobs';

import { JobRegistry } from './define';
import { noopJob } from './system-jobs';

/**
 * Every job the system knows about. Web and worker must use the same registry.
 * When feature packages add jobs (M2: ingest), this list moves to a package that depends on them.
 */
export function createDefaultRegistry(): JobRegistry {
  return new JobRegistry([noopJob]);
}
