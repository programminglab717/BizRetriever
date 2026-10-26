import type { Logger } from '@bizr/platform';
import type { z } from 'zod';

/**
 * Background jobs are ordered lists of **steps** (ADR-011). After every step the run's `state` and
 * position are checkpointed in `app.job_run`, so a run can stop at any step boundary and resume
 * later, in the long-running worker or in a serverless drain call.
 *
 * Rules for step authors:
 * - Steps must be idempotent: a step may run again after a crash before its checkpoint was saved.
 * - A single step invocation must finish well within `JOB_STEP_BUDGET_MS` (default 45s). Split
 *   large work into a repeating step that processes one batch per call and returns `again: true`.
 * - `state` must be JSON-serialisable; it round-trips through Postgres `jsonb`.
 */
export interface StepContext<I, S> {
  runId: string;
  workspaceId: string | null;
  input: I;
  state: S;
  /** Epoch ms by which this invocation should yield. Repeating steps can check it between batches. */
  deadline: number;
  log: Logger;
  /** Persists user-visible progress immediately (shown on processing screens). */
  reportProgress: (stage: string, pct: number) => Promise<void>;
  /**
   * Queues another job (a connected source's import handing on to the next stage). A step may run
   * twice, so guard against queuing twice (check the state the queued job will change).
   */
  enqueue: JobEnqueuer;
}

export type JobEnqueuer = <I2, S2>(
  definition: JobDefinition<I2, S2>,
  input: I2,
  options?: { workspaceId?: string },
) => Promise<string>;

export interface StepOutcome<S> {
  state: S;
  /** Run this same step again (next batch) instead of moving to the next step. */
  again?: boolean;
}

export interface JobStep<I, S> {
  name: string;
  run(ctx: StepContext<I, S>): Promise<StepOutcome<S>>;
}

export interface JobDefinition<I, S> {
  /** Unique job name; also the pg-boss queue name. Use `area.action`, e.g. `ingest.parse`. */
  name: string;
  input: z.ZodType<I>;
  initialState(input: I): S;
  steps: readonly JobStep<I, S>[];
  /** Plain-language message shown to the user if the run fails. */
  failureMessage?: string;
  /** Safety valve against a step that never stops returning `again`. Default 10,000. */
  maxStepInvocations?: number;
}

// Erased form used by the registry and runner.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- definitions are heterogeneous
export type AnyJobDefinition = JobDefinition<any, any>;

export function defineJob<I, S>(definition: JobDefinition<I, S>): JobDefinition<I, S> {
  if (definition.steps.length === 0) throw new Error(`Job ${definition.name} has no steps`);
  const names = new Set(definition.steps.map((s) => s.name));
  if (names.size !== definition.steps.length) {
    throw new Error(`Job ${definition.name} has duplicate step names`);
  }
  return definition;
}

export class JobRegistry {
  readonly #byName = new Map<string, AnyJobDefinition>();

  constructor(definitions: readonly AnyJobDefinition[]) {
    for (const def of definitions) {
      if (this.#byName.has(def.name)) throw new Error(`Duplicate job name ${def.name}`);
      this.#byName.set(def.name, def);
    }
  }

  get(name: string): AnyJobDefinition {
    const def = this.#byName.get(name);
    if (!def) throw new Error(`Unknown job ${name}`);
    return def;
  }

  names(): string[] {
    return [...this.#byName.keys()];
  }
}
