import { closePools, getAppDb, jobRun } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineJob, JobRegistry } from './define';
import { JobQueue } from './queue';
import { noopJob } from './system-jobs';

const hasDb = await databaseAvailable();

// Test-only jobs get unique names so stale queue rows from other runs can never interfere.
const suffix = Math.random().toString(36).slice(2, 8);
const noop = { ...noopJob, name: `test.noop-${suffix}` };
const failing = defineJob({
  name: `test.fail-${suffix}`,
  input: z.object({}),
  initialState: () => ({ reached: [] as string[] }),
  failureMessage: 'We could not finish this test job.',
  steps: [
    { name: 'ok', run: async ({ state }) => ({ state: { reached: [...state.reached, 'ok'] } }) },
    {
      name: 'boom',
      run: async () => {
        throw new Error('kaboom');
      },
    },
  ],
});

async function loadRun(id: string) {
  const run = await getAppDb().query.jobRun.findFirst({ where: eq(jobRun.id, id) });
  if (!run) throw new Error('run missing');
  return run;
}

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe.skipIf(!hasDb)('job system (integration)', () => {
  const registry = new JobRegistry([noop, failing]);
  let queue: JobQueue;

  beforeAll(async () => {
    queue = await JobQueue.start({ registry, supervise: false });
  });

  afterAll(async () => {
    await queue?.stop();
    await closePools();
  });

  it('rejects invalid input before creating a run', async () => {
    await expect(queue.enqueue(noop, { ticks: -1, tickMs: 0 })).rejects.toThrow();
  });

  it('inline mode: drains a run across several budgeted calls, resuming from checkpoints', async () => {
    const runId = await queue.enqueue(noop, { ticks: 4, tickMs: 120 });
    expect((await loadRun(runId)).status).toBe('queued');

    // A tiny budget forces a yield after every step, so the run needs several drain calls.
    let calls = 0;
    let run = await loadRun(runId);
    while (run.status !== 'succeeded' && calls < 20) {
      const summary = await queue.drain({ budgetMs: 50 });
      expect(summary.failed).toBe(0);
      calls += 1;
      run = await loadRun(runId);
    }

    expect(run.status).toBe('succeeded');
    expect(calls).toBeGreaterThan(1);
    expect(run.state).toEqual({ ticksDone: 4, log: ['start', 'finish'] });
    // start + 4 ticks + finish
    expect(run.stepsCompleted).toBe(6);
    expect(run.progress).toEqual({ stage: 'done', pct: 100 });
  });

  it('inline mode: a failing step marks the run failed with a user-safe message', async () => {
    const runId = await queue.enqueue(failing, {});
    await queue.drain({ budgetMs: 5_000 });
    const run = await loadRun(runId);
    expect(run.status).toBe('failed');
    expect(run.state).toEqual({ reached: ['ok'] });
    expect(run.error?.userMessage).toBe('We could not finish this test job.');
    expect(run.error?.step).toBe('boom');
    expect(run.error?.internal).toContain('kaboom');
  });

  it('worker mode: processes a run to completion', async () => {
    await queue.work({ budgetMs: 60_000 });
    const runId = await queue.enqueue(noop, { ticks: 3, tickMs: 0 });
    const run = await waitFor(async () => {
      const r = await loadRun(runId);
      return r.status === 'succeeded' || r.status === 'failed' ? r : undefined;
    });
    expect(run.status).toBe('succeeded');
    expect(run.state).toEqual({ ticksDone: 3, log: ['start', 'finish'] });
  });
});
