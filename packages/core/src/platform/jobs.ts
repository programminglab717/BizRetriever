import { getAppDb, ingestionRun, jobRun, workspace } from '@bizr/db';
import { getEnv } from '@bizr/platform';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { defineJob, type JobStep } from '../jobs/define';
import type { JobQueue } from '../jobs/queue';
import { deliverDueWebhooks, recordWebhookEvent, webhooksDue } from './webhooks';

/** Retries (M16, ADR-066): whatever is due, across businesses, until the step's time is up. */
export const webhooksDeliverJob = defineJob<Record<string, never>, { attempted: number }>({
  name: 'webhooks.deliver',
  input: z.object({}).strict(),
  initialState: () => ({ attempted: 0 }),
  failureMessage: 'Some webhooks weren’t sent. They’ll be tried again.',
  steps: [
    {
      name: 'send-due',
      async run({ state, deadline }) {
        const r = await deliverDueWebhooks({ deadline });
        // Only go round again when time ran out with work still waiting.
        const more = r.attempted > 0 && Date.now() >= deadline && (await webhooksDue());
        return { state: { attempted: state.attempted + r.attempted }, again: more };
      },
    },
  ],
});

/** Called with the hourly/daily check: queues the retry job when something is due. */
export async function queueDueWebhooks(queue: JobQueue): Promise<boolean> {
  if (!(await webhooksDue())) return false;
  const [waiting] = await getAppDb()
    .select({ id: jobRun.id })
    .from(jobRun)
    .where(and(eq(jobRun.jobName, webhooksDeliverJob.name), eq(jobRun.status, 'queued')))
    .limit(1);
  if (waiting) return false;
  await queue.enqueue(webhooksDeliverJob, {});
  return true;
}

/**
 * The last step of an import (M16): tells webhooks that new data is in, then sends straight away
 * (this is background work already). A failure here never fails the import.
 */
export function importWebhookStep<I extends { runId: string }, S>(): JobStep<I, S> {
  return {
    name: 'webhooks',
    async run({ input, state, workspaceId, log }) {
      if (!workspaceId) return { state };
      try {
        const db = getAppDb();
        const [run] = await db
          .select()
          .from(ingestionRun)
          .where(and(eq(ingestionRun.id, input.runId), eq(ingestionRun.workspaceId, workspaceId)));
        if (!run || run.status !== 'done') return { state };
        const [ws] = await db
          .select({ slug: workspace.slug })
          .from(workspace)
          .where(eq(workspace.id, workspaceId));
        const queued = await recordWebhookEvent(
          workspaceId,
          'import.completed',
          `import:${run.id}`,
          {
            import: {
              id: run.id,
              kind: run.kind === 'reupload' ? 'update' : 'first',
              fromLinkedSource: run.connectionId !== null,
              finishedAt: (run.finishedAt ?? new Date()).toISOString(),
              link: `${getEnv().APP_URL}/w/${ws?.slug ?? ''}/data`,
            },
          },
        );
        if (queued > 0) await deliverDueWebhooks({ workspaceId, deadline: Date.now() + 20_000 });
      } catch (err) {
        log.error({ err, workspaceId }, 'webhooks after an import failed');
      }
      return { state };
    },
  };
}
