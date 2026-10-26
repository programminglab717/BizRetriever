import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { app } from './base';
import { workspace } from './workspace';

export const insightLevels = ['urgent', 'warn', 'info'] as const;
export type InsightLevel = (typeof insightLevels)[number];
export const insightStatuses = ['new', 'seen', 'dismissed', 'resolved'] as const;
export type InsightStatus = (typeof insightStatuses)[number];

/** A run of the text as shown: `bold` and `fact` mark what the UI emphasises. */
export interface StoredSegment {
  text: string;
  bold?: true;
  fact?: string;
}

export type StoredInsightAction =
  | { kind: 'ask'; label: string; question: string }
  | { kind: 'records'; label: string; entity: string; search: string | null };

const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

/**
 * Insights (AI_DESIGN §7). One row per fingerprint (rule + item): a run updates it while it still
 * holds and marks it resolved when it no longer does. `facts` are the typed values the sentence was
 * filled from; `headline`/`context` are the rendered text.
 */
export const insight = app.table(
  'insight',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    ruleId: text('rule_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    /** The product, customer… it is about (as stored); null for business-wide insights. */
    subject: text('subject'),
    category: text('category').notNull(),
    level: text('level', { enum: insightLevels }).notNull(),
    /** Urgency then money at stake; Home shows the top five. */
    score: doublePrecision('score').notNull(),
    impact: doublePrecision('impact').notNull().default(0),
    facts: jsonb('facts').notNull(),
    headline: jsonb('headline').$type<StoredSegment[]>().notNull(),
    context: jsonb('context').$type<StoredSegment[]>(),
    /** Plain text of the headline, for search, digests and logs. */
    text: text('text').notNull(),
    action: jsonb('action').$type<StoredInsightAction>(),
    /** Set when Task J's phrasing is shown instead of the pack sentence: its prompt version… */
    phrasedBy: text('phrased_by'),
    /** …and the checked template, re-filled with fresh facts on later runs (no new AI call). */
    phrasedTemplate: text('phrased_template'),
    status: text('status', { enum: insightStatuses }).notNull().default('new'),
    feedback: text('feedback', { enum: ['useful', 'not_useful'] }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    seenAt: timestamp('seen_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    dismissedBy: uuid('dismissed_by').references(() => user.id, { onDelete: 'set null' }),
    /** How serious it was when dismissed: it comes back only if it gets worse. */
    dismissedLevel: text('dismissed_level', { enum: insightLevels }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    unique('insight_fingerprint_unique').on(t.workspaceId, t.fingerprint),
    index('insight_feed_idx').on(t.workspaceId, t.status, t.score),
    check('insight_level_check', inList(t.level.name, insightLevels)),
    check('insight_status_check', inList(t.status.name, insightStatuses)),
  ],
);
export type Insight = typeof insight.$inferSelect;

/** The owner's alert settings per rule (unset: the pack's defaults). */
export const insightSetting = app.table(
  'insight_setting',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    ruleId: text('rule_id').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    thresholds: jsonb('thresholds')
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    updatedBy: uuid('updated_by').references(() => user.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.ruleId] })],
);

export interface InsightRunRule {
  id: string;
  status: 'ran' | 'skipped' | 'failed';
  /** Plain-language reason when skipped or failed. */
  reason?: string;
  found?: number;
}

/** One pass of the rules over a workspace's data: what ran, what was skipped and why. */
export const insightRun = app.table(
  'insight_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    trigger: text('trigger').notNull(),
    /** The business's "today" the rules ran for. */
    today: date('today', { mode: 'string' }).notNull(),
    /** The workspace's data version the rules ran on: Home re-runs them when the data moved on. */
    dataVersion: integer('data_version').notNull().default(0),
    /** Days of sales history (null: no sales yet). */
    historyDays: integer('history_days'),
    rules: jsonb('rules').$type<InsightRunRule[]>().notNull(),
    created: integer('created').notNull().default(0),
    updated: integer('updated').notNull().default(0),
    resolved: integer('resolved').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('insight_run_workspace_idx').on(t.workspaceId, t.startedAt)],
);

/** The weekly in-app digest (PRODUCT_SPEC Journey 5): one per workspace per week. */
export const digest = app.table(
  'digest',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    /** The Monday the digest is for (the week before it is summarised). */
    weekOf: date('week_of', { mode: 'string' }).notNull(),
    content: jsonb('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (t) => [unique('digest_week_unique').on(t.workspaceId, t.weekOf)],
);

export const emailKinds = ['weekly_summary', 'urgent_alert'] as const;
export type EmailKind = (typeof emailKinds)[number];

/**
 * Which emails a person gets from one business (M9, ADR-057). No row means the defaults: both on.
 * Every email links to a one-click unsubscribe that turns its kind off here.
 */
export const emailPreference = app.table(
  'email_preference',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    weeklySummary: boolean('weekly_summary').notNull().default(true),
    urgentAlerts: boolean('urgent_alerts').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

/**
 * Each email sent, or about to be: written before sending, so a re-run never sends the same
 * summary (key: its week) or alert (key: the insight) twice.
 */
export const emailDelivery = app.table(
  'email_delivery',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: emailKinds }).notNull(),
    key: text('key').notNull(),
    status: text('status', { enum: ['sending', 'sent', 'logged', 'failed'] })
      .notNull()
      .default('sending'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [
    unique('email_delivery_unique').on(t.workspaceId, t.userId, t.kind, t.key),
    check('email_delivery_kind_check', inList(t.kind.name, emailKinds)),
  ],
);
