import { index, integer, numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { app } from './base';
import { workspace } from './workspace';

/** Every AI call, live or replayed (CLAUDE.md Observability; ADR-027 spend guard reads this). */
export const aiCall = app.table(
  'ai_call',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').references(() => workspace.id, { onDelete: 'set null' }),
    task: text('task').notNull(),
    promptVersion: text('prompt_version').notNull(),
    tier: text('tier').notNull(),
    model: text('model').notNull(),
    status: text('status').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    error: text('error'),
    correlationId: text('correlation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_call_created_idx').on(t.createdAt),
    index('ai_call_workspace_idx').on(t.workspaceId, t.createdAt),
  ],
);
