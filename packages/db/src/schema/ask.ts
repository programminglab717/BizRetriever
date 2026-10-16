import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { app } from './base';
import { workspace } from './workspace';

/** One thread of questions in Ask (follow-ups use its earlier answers as context). */
export const conversation = app.table(
  'conversation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('conversation_workspace_idx').on(t.workspaceId, t.updatedAt)],
);

export const answerKinds = ['query', 'clarify', 'sql', 'unanswerable', 'error'] as const;
export type AnswerKind = (typeof answerKinds)[number];

/**
 * One question and its answer. `interpretation` is what the question was taken to mean (typed, from
 * `@bizr/core/ask`); `content` is the rendered answer as shown, with a capped copy of the result so
 * old answers read back without re-running.
 */
export const answer = app.table(
  'answer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    question: text('question').notNull(),
    kind: text('kind', { enum: answerKinds }).notNull(),
    /** rules | ai | rules_fallback | none */
    origin: text('origin').notNull(),
    interpretation: jsonb('interpretation').notNull(),
    content: jsonb('content').notNull(),
    feedback: smallint('feedback'),
    feedbackReason: text('feedback_reason'),
    latencyMs: integer('latency_ms').notNull().default(0),
    aiCalls: integer('ai_calls').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('answer_conversation_idx').on(t.conversationId, t.createdAt),
    index('answer_workspace_idx').on(t.workspaceId, t.createdAt),
    check('answer_feedback_check', sql`${t.feedback} in (-1, 1)`),
  ],
);

/** A workspace's dashboards (M5 adds editing and versions; M4 pins tiles to the default one). */
export const dashboard = app.table(
  'dashboard',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('dashboard_workspace_idx').on(t.workspaceId)],
);

/**
 * A tile: a question spec plus how to show it. Tiles follow the dashboard's dates unless
 * `fixedDates` (the question named its own dates, e.g. "March 2026").
 */
export const dashboardTile = app.table(
  'dashboard_tile',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dashboardId: uuid('dashboard_id')
      .notNull()
      .references(() => dashboard.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    spec: jsonb('spec').notNull(),
    chart: text('chart').notNull(),
    layout: jsonb('layout').$type<{ x: number; y: number; w: number; h: number }>().notNull(),
    position: integer('position').notNull(),
    fixedDates: boolean('fixed_dates').notNull().default(false),
    sourceAnswerId: uuid('source_answer_id').references(() => answer.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('dashboard_tile_dashboard_idx').on(t.dashboardId, t.position)],
);
