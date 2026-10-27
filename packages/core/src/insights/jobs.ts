import { getAppDb, jobRun, workspace } from '@bizr/db';
import { getLogger } from '@bizr/platform';
import { and, eq, gt, gte, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { connectionsDailyJob } from '../connections/jobs';
import { defineJob, type JobStep } from '../jobs/define';
import { queueDueWebhooks } from '../platform/jobs';
import { deliverDueWebhooks, recordInsightEvents } from '../platform/webhooks';
import { reportsDailyJob } from '../reports/jobs';
import type { JobQueue } from '../jobs/queue';
import { snapshotGcJob } from '../structure/gc';

import { sendInsightEmails } from './email';
import { loadInsightTarget, runInsights, type InsightTarget } from './service';

/**
 * `insights.run`: the rules for one workspace, after a data change. `insights.daily`: every active
 * workspace once a day (new day, new "last 7 days"), which also writes each weekly digest. Both are
 * a step per workspace, so a drain call can stop between workspaces and pick up where it left off.
 */

export const insightTriggers = [
  'import',
  'reupload',
  'record_edit',
  'structure_change',
  'settings',
  'home',
  'daily',
] as const;
export type InsightTrigger = (typeof insightTriggers)[number];

/** Runs the rules, then sends what's due by email. An email problem never fails the run. */
async function runAndEmail(target: InsightTarget, trigger: InsightTrigger) {
  const summary = await runInsights(target, { trigger });
  try {
    await sendInsightEmails(target);
  } catch (err) {
    getLogger('insight-email').error({ err, workspaceId: target.workspace.id }, 'emails failed');
  }
  // Webhooks that asked about new insights (M16), sent now: this is background work already.
  try {
    if (await recordInsightEvents(target.workspace.id, summary.createdIds))
      await deliverDueWebhooks({ workspaceId: target.workspace.id, deadline: Date.now() + 20_000 });
  } catch (err) {
    getLogger('webhooks').error({ err, workspaceId: target.workspace.id }, 'webhooks failed');
  }
  return summary;
}

const runInput = z.object({ workspaceId: z.uuid(), trigger: z.enum(insightTriggers) }).strict();

export const insightsRunJob = defineJob<z.infer<typeof runInput>, { created?: number }>({
  name: 'insights.run',
  input: runInput,
  initialState: () => ({}),
  failureMessage: 'We couldn’t check your data for insights just now. We’ll try again soon.',
  steps: [
    {
      name: 'run-rules',
      async run({ input }) {
        const target = await loadInsightTarget(input.workspaceId);
        if (!target || target.workspace.status !== 'active') return { state: {} };
        const summary = await runAndEmail(target, input.trigger);
        return { state: { created: summary.created } };
      },
    },
  ],
});

interface DailyState {
  /** Workspaces still to do; null until listed. */
  remaining: string[] | null;
  done: number;
}

export const insightsDailyJob = defineJob<{ date: string }, DailyState>({
  name: 'insights.daily',
  input: z.object({ date: z.iso.date() }).strict(),
  initialState: () => ({ remaining: null, done: 0 }),
  failureMessage: 'The daily insight check didn’t finish. It will try again tomorrow.',
  steps: [
    {
      name: 'list-workspaces',
      async run({ state }) {
        const rows = await getAppDb()
          .select({ id: workspace.id })
          .from(workspace)
          .where(and(eq(workspace.status, 'active'), gt(workspace.dataVersion, 0)));
        return { state: { ...state, remaining: rows.map((r) => r.id) } };
      },
    },
    {
      name: 'run-each',
      async run({ state, deadline, log }) {
        const remaining = [...(state.remaining ?? [])];
        let done = state.done;
        while (remaining.length > 0 && Date.now() < deadline) {
          const id = remaining.shift()!;
          try {
            const target = await loadInsightTarget(id);
            if (target) await runAndEmail(target, 'daily');
          } catch (err) {
            // One business's trouble mustn't stop everyone else's check.
            log.error({ err, workspaceId: id }, 'daily insights failed for a workspace');
          }
          done += 1;
        }
        return { state: { remaining, done }, again: remaining.length > 0 };
      },
    },
  ],
});

/**
 * Queues an insight run unless one is already waiting for this workspace: several changes in a row
 * (a burst of record edits) share one run.
 */
export async function requestInsightRun(
  queue: JobQueue,
  workspaceId: string,
  trigger: InsightTrigger,
): Promise<string> {
  const [waiting] = await getAppDb()
    .select({ id: jobRun.id })
    .from(jobRun)
    .where(
      and(
        eq(jobRun.jobName, insightsRunJob.name),
        eq(jobRun.workspaceId, workspaceId),
        eq(jobRun.status, 'queued'),
      ),
    )
    .limit(1);
  if (waiting) return waiting.id;
  return queue.enqueue(insightsRunJob, { workspaceId, trigger }, { workspaceId });
}

/**
 * The daily jobs (ARCHITECTURE §jobs): insight catch-up plus digests, expired-backup clean-up, and
 * checking linked sources.
 * Safe to call many times a day: each is queued at most once per UTC day.
 */
export async function scheduleDailyJobs(queue: JobQueue, now = new Date()): Promise<string[]> {
  const date = now.toISOString().slice(0, 10);
  const startOfDay = new Date(`${date}T00:00:00Z`);
  const already = new Set(
    (
      await getAppDb()
        .select({ name: jobRun.jobName })
        .from(jobRun)
        .where(
          and(
            inArray(jobRun.jobName, [
              insightsDailyJob.name,
              snapshotGcJob.name,
              connectionsDailyJob.name,
              reportsDailyJob.name,
            ]),
            gte(jobRun.createdAt, startOfDay),
          ),
        )
    ).map((r) => r.name),
  );
  const queued: string[] = [];
  if (!already.has(insightsDailyJob.name)) {
    await queue.enqueue(insightsDailyJob, { date });
    queued.push(insightsDailyJob.name);
  }
  if (!already.has(snapshotGcJob.name)) {
    await queue.enqueue(snapshotGcJob, {});
    queued.push(snapshotGcJob.name);
  }
  // Linked sources first thing, so the day's insights see their changes (ADR-058).
  if (!already.has(connectionsDailyJob.name)) {
    await queue.enqueue(connectionsDailyJob, { date });
    queued.push(connectionsDailyJob.name);
  }
  if (!already.has(reportsDailyJob.name)) {
    await queue.enqueue(reportsDailyJob, { date });
    queued.push(reportsDailyJob.name);
  }
  // Not daily: webhook retries whenever this runs (hourly in the worker) and one is due (M16).
  if (await queueDueWebhooks(queue)) queued.push('webhooks.deliver');
  return queued;
}

/**
 * The last step of a job that changed data: refresh insights. Never fails the job (the data change
 * already happened); Home notices a missed run and queues another.
 */
export function refreshInsightsStep<I, S>(trigger: InsightTrigger): JobStep<I, S> {
  return {
    name: 'insights',
    async run({ workspaceId, state, log }) {
      if (!workspaceId) return { state };
      try {
        const target = await loadInsightTarget(workspaceId);
        if (target) await runAndEmail(target, trigger);
      } catch (err) {
        log.error({ err, workspaceId }, 'insights after a data change failed');
      }
      return { state };
    },
  };
}
