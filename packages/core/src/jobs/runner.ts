import { getAppDb, jobRun, type AppDb, type JobRunError } from '@bizr/db';
import { getLogger, withLogContext } from '@bizr/platform';
import { and, eq, sql } from 'drizzle-orm';

import type { JobRegistry } from './define';

export type AdvanceStatus = 'succeeded' | 'failed' | 'yielded' | 'skipped';

export interface AdvanceResult {
  status: AdvanceStatus;
  stepsRun: number;
}

export interface AdvanceOptions {
  /** Stop starting new steps once this much time has passed. At least one step always runs. */
  budgetMs: number;
  db?: AppDb;
  now?: () => number;
}

const DEFAULT_FAILURE_MESSAGE =
  'Something went wrong while working on this. Your data is safe. Please try again.';

/**
 * Runs as many steps of a job run as fit in the time budget, checkpointing after each one.
 * Safe to call repeatedly: finished runs are skipped, and checkpoints use optimistic concurrency
 * on `step_index` so two callers can never both record the same step.
 */
export async function advanceRun(
  registry: JobRegistry,
  runId: string,
  options: AdvanceOptions,
): Promise<AdvanceResult> {
  const db = options.db ?? getAppDb();
  const now = options.now ?? Date.now;
  const started = now();

  const run = await db.query.jobRun.findFirst({ where: eq(jobRun.id, runId) });
  if (!run) throw new Error(`Job run ${runId} not found`);
  if (run.status === 'succeeded' || run.status === 'failed')
    return { status: 'skipped', stepsRun: 0 };

  const def = registry.get(run.jobName);
  const log = getLogger('jobs').child({ job: def.name, runId });

  return withLogContext({ workspaceId: run.workspaceId ?? undefined }, async () => {
    const input: unknown = def.input.parse(run.input);
    if (run.status === 'queued') {
      await db
        .update(jobRun)
        .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(jobRun.id, runId), eq(jobRun.status, 'queued')));
    }

    let state: unknown = run.state;
    let index = run.stepIndex;
    let invocations = run.stepsCompleted;
    let stepsRun = 0;
    const maxInvocations = def.maxStepInvocations ?? 10_000;

    while (index < def.steps.length) {
      if (stepsRun > 0 && now() - started >= options.budgetMs) {
        log.debug({ index, stepsRun }, 'yielding: step budget used');
        return { status: 'yielded', stepsRun };
      }
      const step = def.steps[index]!;
      if (invocations >= maxInvocations) {
        await markFailed(db, runId, def.failureMessage, step.name, 'too many step invocations');
        return { status: 'failed', stepsRun };
      }

      let outcome;
      try {
        outcome = await step.run({
          runId,
          workspaceId: run.workspaceId,
          input,
          state,
          deadline: started + options.budgetMs,
          log: log.child({ step: step.name }),
          reportProgress: async (stage, pct) => {
            await db
              .update(jobRun)
              .set({
                progress: { stage, pct: Math.max(0, Math.min(100, pct)) },
                updatedAt: new Date(),
              })
              .where(eq(jobRun.id, runId));
          },
        });
      } catch (err) {
        log.error({ err, step: step.name }, 'job step failed');
        await markFailed(db, runId, def.failureMessage, step.name, errorText(err));
        return { status: 'failed', stepsRun };
      }

      const nextIndex = outcome.again ? index : index + 1;
      const saved = await db
        .update(jobRun)
        .set({
          state: outcome.state as object,
          stepIndex: nextIndex,
          stepsCompleted: sql`${jobRun.stepsCompleted} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(jobRun.id, runId), eq(jobRun.stepIndex, index), eq(jobRun.status, 'running')))
        .returning({ id: jobRun.id });
      if (saved.length === 0) {
        throw new Error(`Checkpoint conflict on job run ${runId} at step ${step.name}`);
      }

      state = outcome.state;
      index = nextIndex;
      invocations += 1;
      stepsRun += 1;
    }

    await db
      .update(jobRun)
      .set({
        status: 'succeeded',
        progress: { stage: 'done', pct: 100 },
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(jobRun.id, runId));
    log.info({ stepsRun }, 'job run succeeded');
    return { status: 'succeeded', stepsRun };
  });
}

async function markFailed(
  db: AppDb,
  runId: string,
  userMessage: string | undefined,
  step: string,
  internal: string,
): Promise<void> {
  const error: JobRunError = {
    userMessage: userMessage ?? DEFAULT_FAILURE_MESSAGE,
    internal,
    step,
  };
  await db
    .update(jobRun)
    .set({ status: 'failed', error, finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(jobRun.id, runId));
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message;
  return String(err);
}
