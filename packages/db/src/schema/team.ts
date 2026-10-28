import { sql } from 'drizzle-orm';
import { check, index, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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

/**
 * A person named in a note with "@Their Name" (M19, ADR-069). It shows under "For you" on their
 * Home until they dismiss it, and is emailed to them unless they turned that off.
 */
export const noteMention = app.table(
  'note_mention',
  {
    noteId: uuid('note_id')
      .notNull()
      .references(() => note.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    seenAt: timestamp('seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.noteId, t.userId] }),
    index('note_mention_user_idx').on(t.workspaceId, t.userId, t.seenAt),
  ],
);

export const transferDecisions = ['accepted', 'declined', 'cancelled'] as const;

/**
 * The owner handing the business to someone already in it (M19, ADR-069). Nothing changes until
 * that person accepts; then they become the owner and the old owner a member, in one step. One
 * waiting at a time per business; it lapses after seven days.
 */
export const ownershipTransfer = app.table(
  'ownership_transfer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    fromUserId: uuid('from_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    toUserId: uuid('to_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    decision: text('decision', { enum: transferDecisions }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('ownership_transfer_waiting_idx')
      .on(t.workspaceId)
      .where(sql`${t.decision} is null`),
    check(
      'ownership_transfer_decision_check',
      sql`${t.decision} is null or ${t.decision} in ('accepted', 'declined', 'cancelled')`,
    ),
  ],
);
export type OwnershipTransfer = typeof ownershipTransfer.$inferSelect;
