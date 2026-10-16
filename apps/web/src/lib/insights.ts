import 'server-only';

import { requestInsightRun, type InsightTrigger } from '@bizr/core/insights';
import { getLogger } from '@bizr/platform';

import { kickJobs } from '@/lib/imports';
import { getJobQueue } from '@/lib/jobs';

/**
 * After a change to someone's data: queue an insight run (one waiting run per business covers a
 * burst of edits). Never fails the change itself; Home queues a run if this one went missing.
 */
export async function queueInsights(workspaceId: string, trigger: InsightTrigger): Promise<void> {
  try {
    await requestInsightRun(await getJobQueue(), workspaceId, trigger);
    kickJobs();
  } catch (err) {
    getLogger('insights').error({ err, workspaceId, trigger }, 'queueing insights failed');
  }
}

/** Runs a data change, then queues insights if it worked. */
export async function withInsights<T>(
  workspaceId: string,
  trigger: InsightTrigger,
  change: () => Promise<T>,
): Promise<T> {
  const result = await change();
  await queueInsights(workspaceId, trigger);
  return result;
}
