import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { app } from './base';
import { workspace } from './workspace';

const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

/**
 * A key another app uses to read one business's numbers (M16, ADR-066). Only the SHA-256 of the
 * key is kept; the key itself is shown once. A key reads like a "can view" member and never
 * changes anything. `windowStart`/`windowCount` hold the per-minute request count.
 */
export const apiKey = app.table(
  'api_key',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** The first characters, to tell keys apart ("bzr_k7Qp…"). */
    prefix: text('prefix').notNull(),
    hash: text('hash').notNull(),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    windowStart: timestamp('window_start', { withTimezone: true }),
    windowCount: integer('window_count').notNull().default(0),
  },
  (t) => [
    uniqueIndex('api_key_hash_idx').on(t.hash),
    index('api_key_workspace_idx').on(t.workspaceId),
  ],
);
export type ApiKey = typeof apiKey.$inferSelect;

export const webhookEvents = ['insight.created', 'import.completed'] as const;
export type WebhookEvent = (typeof webhookEvents)[number];

/**
 * An address told when something happens in a business (M16, ADR-066). `secret` signs each
 * delivery; it is stored sealed (AES-GCM under CONNECTOR_SECRET) because it has to be used again.
 */
export const webhook = app.table(
  'webhook',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    events: text('events').array().notNull(),
    secret: text('secret').notNull(),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Deliveries that failed in a row; reset by a success. */
    failures: integer('failures').notNull().default(0),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
    lastStatus: integer('last_status'),
    lastError: text('last_error'),
  },
  (t) => [index('webhook_workspace_idx').on(t.workspaceId)],
);
export type Webhook = typeof webhook.$inferSelect;

export const deliveryStatuses = ['pending', 'sent', 'failed'] as const;

/**
 * One event for one webhook (an outbox). `eventKey` makes recording idempotent: the same insight
 * or import is queued once per webhook however often the step that records it runs.
 */
export const webhookDelivery = app.table(
  'webhook_delivery',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhook.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    eventKey: text('event_key').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status', { enum: deliveryStatuses }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    /** Held by a sender until then, so two runs never send the same delivery at once. */
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastStatus: integer('last_status'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('webhook_delivery_event_idx').on(t.webhookId, t.eventKey),
    index('webhook_delivery_due_idx').on(t.status, t.nextAttemptAt),
    check('webhook_delivery_status_check', inList(t.status.name, deliveryStatuses)),
  ],
);
export type WebhookDelivery = typeof webhookDelivery.$inferSelect;
