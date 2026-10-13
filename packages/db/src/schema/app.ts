import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Control-plane schema (ARCHITECTURE §4). Tenant data never lives here. */
export const app = pgSchema('app');

export const jobRunStatus = ['queued', 'running', 'succeeded', 'failed'] as const;
export type JobRunStatus = (typeof jobRunStatus)[number];

export interface JobRunProgress {
  stage: string;
  pct: number;
}

export interface JobRunError {
  /** Safe to show to the user. */
  userMessage: string;
  /** For logs and support only. */
  internal: string;
  step: string;
}

/**
 * One row per background job run (ADR-011). Jobs are sequences of checkpointed steps; the
 * checkpoint (`stepIndex` + `state`) lives here so a run can resume in a worker or a drain call.
 */
export const jobRun = app.table(
  'job_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // FK to app.workspace is added in M1 when the workspace table exists.
    workspaceId: uuid('workspace_id'),
    jobName: text('job_name').notNull(),
    status: text('status', { enum: jobRunStatus }).notNull().default('queued'),
    input: jsonb('input').notNull(),
    state: jsonb('state')
      .notNull()
      .default(sql`'{}'::jsonb`),
    stepIndex: integer('step_index').notNull().default(0),
    stepsCompleted: integer('steps_completed').notNull().default(0),
    progress: jsonb('progress').$type<JobRunProgress>(),
    error: jsonb('error').$type<JobRunError>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('job_run_workspace_idx').on(t.workspaceId, t.createdAt),
    index('job_run_status_idx').on(t.status),
    check(
      'job_run_status_check',
      sql.raw(`${t.status.name} in (${jobRunStatus.map((s) => `'${s}'`).join(', ')})`),
    ),
  ],
);

export type JobRun = typeof jobRun.$inferSelect;
