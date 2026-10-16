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
  unique,
  uniqueIndex,
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

export interface DashboardSettings {
  /** The date range tiles follow, unless they have fixed dates (validated where it's read). */
  range?: { range: { preset: string } | { from: string; to: string }; compare: boolean };
  /** Pack tiles the owner removed: never added back when new data arrives. */
  removedPackTiles?: string[];
}

export interface TileOptions {
  /** Over-time tiles: weekly, or monthly when the range is longer than 120 days. */
  autoGrain?: boolean;
}

/** A workspace's dashboards. The default one is built from the pack (M5) and holds pinned answers. */
export const dashboard = app.table(
  'dashboard',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    settings: jsonb('settings').$type<DashboardSettings>().notNull().default({}),
    /** When the pack's tiles were last added (null: never). */
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('dashboard_workspace_idx').on(t.workspaceId),
    // One default dashboard per workspace.
    uniqueIndex('dashboard_default_unique')
      .on(t.workspaceId)
      .where(sql`${t.isDefault}`),
  ],
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
    /** The pack tile this came from (default dashboard), or null for the owner's own tiles. */
    packKey: text('pack_key'),
    options: jsonb('options').$type<TileOptions>().notNull().default({}),
    sourceAnswerId: uuid('source_answer_id').references(() => answer.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('dashboard_tile_dashboard_idx').on(t.dashboardId, t.position)],
);

/**
 * The dashboard's tiles after each saved change, for undo and history. Version 1 is the generated
 * dashboard; every edit (by chat or by hand) adds one.
 */
export const dashboardVersion = app.table(
  'dashboard_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dashboardId: uuid('dashboard_id')
      .notNull()
      .references(() => dashboard.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    tiles: jsonb('tiles').notNull(),
    summary: text('summary').notNull(),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('dashboard_version_unique').on(t.dashboardId, t.version)],
);
