import { getAppDb, jobRun, type AppDb } from '@bizr/db';
import { getEnv, getLogger, withLogContext } from '@bizr/platform';
import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss, type Job } from 'pg-boss';

import type { JobDefinition, JobRegistry } from './define';
import { advanceRun, type AdvanceResult } from './runner';

interface QueuePayload {
  runId: string;
}

export interface JobQueueOptions {
  registry: JobRegistry;
  /** Defaults to DATABASE_URL_APP (the control-plane role owns the `pgboss` schema). */
  connectionString?: string;
  /** Run pg-boss maintenance (expiry, retention) on a timer. True in the worker, false in web. */
  supervise: boolean;
  db?: AppDb;
}

export interface DrainSummary {
  processed: number;
  succeeded: number;
  failed: number;
  yielded: number;
  elapsedMs: number;
}

const log = () => getLogger('jobs');

/**
 * Thin wrapper over pg-boss. A pg-boss job means "advance job run X"; when a run yields because
 * its time budget ran out, a continuation job for the same run is queued.
 */
export class JobQueue {
  readonly #boss: PgBoss;
  readonly #registry: JobRegistry;
  readonly #db: AppDb;

  private constructor(boss: PgBoss, registry: JobRegistry, db: AppDb) {
    this.#boss = boss;
    this.#registry = registry;
    this.#db = db;
  }

  static async start(options: JobQueueOptions): Promise<JobQueue> {
    const boss = new PgBoss({
      connectionString: options.connectionString ?? getEnv().DATABASE_URL_APP,
      schema: 'pgboss',
      createSchema: false, // created by `pnpm db:setup`, owned by the app role
      migrate: true,
      supervise: options.supervise,
      schedule: false,
      application_name: 'bizr_jobs',
    });
    boss.on('error', (err) => log().error({ err }, 'pg-boss error'));
    await boss.start();
    for (const name of options.registry.names()) {
      if (!(await boss.getQueue(name))) {
        await boss.createQueue(name, {
          retryLimit: 2,
          retryDelay: 5,
          retryBackoff: true,
          expireInSeconds: 15 * 60,
        });
      }
    }
    return new JobQueue(boss, options.registry, options.db ?? getAppDb());
  }

  /** Creates a job run and queues it in one transaction. Returns the run id. */
  async enqueue<I, S>(
    definition: JobDefinition<I, S>,
    input: I,
    options: { workspaceId?: string } = {},
  ): Promise<string> {
    const def = this.#registry.get(definition.name);
    const parsed = definition.input.parse(input);
    return this.#db.transaction(async (tx) => {
      const [row] = await tx
        .insert(jobRun)
        .values({
          jobName: def.name,
          workspaceId: options.workspaceId ?? null,
          input: parsed,
          state: definition.initialState(parsed),
        })
        .returning({ id: jobRun.id });
      const runId = row!.id;
      await this.#boss.send(def.name, { runId } satisfies QueuePayload, {
        db: fromDrizzle(tx, sql),
      });
      return runId;
    });
  }

  /** Worker mode: subscribe to every queue and process runs as they arrive. */
  async work(options: { budgetMs: number }): Promise<void> {
    for (const name of this.#registry.names()) {
      await this.#boss.work<QueuePayload>(
        name,
        { batchSize: 1, pollingIntervalSeconds: 1 },
        async ([job]) => {
          if (job) await this.#process(job, options.budgetMs);
        },
      );
    }
  }

  /**
   * Inline mode: process due jobs until the time budget is used or nothing is left.
   * Called by the authenticated drain route; one call never runs longer than about
   * `budgetMs` plus the duration of one step.
   */
  async drain(options: { budgetMs: number; maintenance?: boolean }): Promise<DrainSummary> {
    const started = Date.now();
    const summary: DrainSummary = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      yielded: 0,
      elapsedMs: 0,
    };
    if (options.maintenance) await this.#boss.supervise();

    let foundWork = true;
    while (foundWork && Date.now() - started < options.budgetMs) {
      foundWork = false;
      for (const name of this.#registry.names()) {
        const remaining = options.budgetMs - (Date.now() - started);
        if (remaining <= 0) break;
        const [job] = await this.#boss.fetch<QueuePayload>(name, { batchSize: 1 });
        if (!job) continue;
        foundWork = true;
        try {
          const result = await this.#process(job, remaining);
          await this.#boss.complete(name, job.id);
          summary.processed += 1;
          if (result.status === 'succeeded') summary.succeeded += 1;
          if (result.status === 'failed') summary.failed += 1;
          if (result.status === 'yielded') summary.yielded += 1;
        } catch (err) {
          log().error({ err, job: name }, 'drain: job processing error');
          await this.#boss.fail(name, job.id, { message: String(err) });
        }
      }
    }
    summary.elapsedMs = Date.now() - started;
    return summary;
  }

  async stop(): Promise<void> {
    await this.#boss.stop({ graceful: true, timeout: 30_000 });
  }

  async #process(job: Job<QueuePayload>, budgetMs: number): Promise<AdvanceResult> {
    return withLogContext({}, async () => {
      const result = await advanceRun(this.#registry, job.data.runId, {
        budgetMs,
        db: this.#db,
      });
      if (result.status === 'yielded') {
        await this.#boss.send(job.name, { runId: job.data.runId } satisfies QueuePayload);
      }
      return result;
    });
  }
}
