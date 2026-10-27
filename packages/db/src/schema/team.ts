import { sql } from 'drizzle-orm';
import { check, index, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { user } from './auth';
import { app } from './base';
import { workspace } from './workspace';

const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

/** What a note can be left on (M13). */
export const noteSubjects = ['insight', 'answer'] as const;
export type NoteSubject = (typeof noteSubjects)[number];

/**
 * A short plain-text note a person leaves on an insight or an answer ("ordered 50 more, arriving
 * Friday"), seen by everyone in the business (M13, ADR-062). Never given to the AI, never shown as
 * a fact.
 */
export const note = app.table(
  'note',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    subjectKind: text('subject_kind', { enum: noteSubjects }).notNull(),
    subjectId: uuid('subject_id').notNull(),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('note_subject_idx').on(t.workspaceId, t.subjectKind, t.subjectId, t.createdAt),
    check('note_subject_check', inList(t.subjectKind.name, noteSubjects)),
    check('note_body_check', sql`char_length(${t.body}) between 1 and 1000`),
  ],
);
export type Note = typeof note.$inferSelect;
