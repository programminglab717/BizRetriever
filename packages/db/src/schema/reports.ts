import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { answer } from './ask';
import { user } from './auth';
import { app } from './base';
import { workspace } from './workspace';

const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

export const reportKinds = ['dashboard', 'question'] as const;
export const reportCadences = ['weekly', 'monthly'] as const;

/**
 * A report someone asked to have emailed to them (M15, ADR-065): the dashboard or one question,
 * worked out fresh and sent as a PDF once a week or once a month. Only ever to the person who set it
 * up, while they're part of the business.
 */
export const reportSchedule = app.table(
  'report_schedule',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: reportKinds }).notNull(),
    /** For a question: the answer whose meaning is re-run each time. */
    answerId: uuid('answer_id').references(() => answer.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    cadence: text('cadence', { enum: reportCadences }).notNull(),
    /** Weekly: 1 = Monday … 7 = Sunday. Monthly: day of the month, 1–28. */
    day: integer('day').notNull(),
    paused: boolean('paused').notNull().default(false),
    /** The last period sent ("2026-W44", "2026-11"), so each is sent once. */
    lastPeriod: text('last_period'),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('report_schedule_workspace_idx').on(t.workspaceId, t.userId),
    check('report_schedule_kind_check', inList(t.kind.name, reportKinds)),
    check('report_schedule_cadence_check', inList(t.cadence.name, reportCadences)),
    check('report_schedule_day_check', sql`${t.day} between 1 and 28`),
    check(
      'report_schedule_answer_check',
      sql`(${t.kind} = 'question') = (${t.answerId} is not null)`,
    ),
  ],
);
export type ReportSchedule = typeof reportSchedule.$inferSelect;
