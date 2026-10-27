import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { app } from './base';
import { user } from './auth';

const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`);

export const workspaceStatus = ['provisioning', 'active', 'failed', 'deleting'] as const;
export type WorkspaceStatus = (typeof workspaceStatus)[number];

/** A business. Its data lives in its own tenant schema (ADR-004). */
export const workspace = app.table(
  'workspace',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    tenantSchema: text('tenant_schema').notNull().unique(),
    packId: text('pack_id').notNull(),
    packVersion: text('pack_version').notNull(),
    status: text('status', { enum: workspaceStatus }).notNull().default('provisioning'),
    isDemo: boolean('is_demo').notNull().default(false),
    /** Bumped whenever the business's records change (imports, edits): keys cached results. */
    dataVersion: integer('data_version').notNull().default(0),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('workspace_status_check', inList(t.status.name, workspaceStatus)),
    check('workspace_tenant_schema_check', sql`${t.tenantSchema} ~ '^t_[a-z0-9]{10}$'`),
  ],
);

/**
 * Owners do everything; members everything except managing people and deleting the business;
 * viewers (M13) look, ask, download and leave notes, and change nothing.
 */
export const memberRoles = ['owner', 'member', 'viewer'] as const;
export type MemberRole = (typeof memberRoles)[number];
export const memberStatus = ['active', 'invited'] as const;

export const workspaceMember = app.table(
  'workspace_member',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: memberRoles }).notNull(),
    status: text('status', { enum: memberStatus }).notNull().default('active'),
    invitedBy: uuid('invited_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('workspace_member_user_idx').on(t.userId),
    check('workspace_member_role_check', inList(t.role.name, memberRoles)),
    check('workspace_member_status_check', inList(t.status.name, memberStatus)),
  ],
);

/**
 * An invitation to join a business (M6). Only a hash of the link's token is stored. Pending until
 * accepted, revoked or expired (7 days).
 */
export const workspaceInvite = app.table(
  'workspace_invite',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    /** Lower case. */
    email: text('email').notNull(),
    role: text('role', { enum: memberRoles }).notNull().default('member'),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => user.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('workspace_invite_workspace_idx').on(t.workspaceId, t.email)],
);

export const dateOrders = ['DMY', 'MDY', 'YMD'] as const;
export type DateOrder = (typeof dateOrders)[number];

export const workspaceSettings = app.table(
  'workspace_settings',
  {
    workspaceId: uuid('workspace_id')
      .primaryKey()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    currency: char('currency', { length: 3 }).notNull(),
    timezone: text('timezone').notNull(),
    dateOrder: text('date_order', { enum: dateOrders }).notNull(),
    fiscalYearStartMonth: smallint('fiscal_year_start_month').notNull().default(1),
    /** ISO weekday: 1 = Monday … 7 = Sunday. */
    weekStart: smallint('week_start').notNull().default(1),
    piiMasking: boolean('pii_masking').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('workspace_settings_date_order_check', inList(t.dateOrder.name, dateOrders)),
    check('workspace_settings_fy_check', sql`${t.fiscalYearStartMonth} between 1 and 12`),
    check('workspace_settings_week_check', sql`${t.weekStart} between 1 and 7`),
  ],
);

/** Generic audit trail: auth events, approvals, confirmations, provisioning, rollbacks. */
export const auditEvent = app.table(
  'audit_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    details: jsonb('details')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_event_workspace_idx').on(t.workspaceId, t.createdAt)],
);

export const queryOrigins = ['ask', 'dashboard', 'insight', 'records', 'system', 'api'] as const;
export type QueryOrigin = (typeof queryOrigins)[number];
export const queryPaths = ['spec', 'sql_fallback', 'system'] as const;
export type QueryPath = (typeof queryPaths)[number];

/** Every query executed against a tenant schema (CLAUDE.md, Observability). */
export const queryRun = app.table(
  'query_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    origin: text('origin', { enum: queryOrigins }).notNull(),
    path: text('path', { enum: queryPaths }).notNull(),
    mode: text('mode', { enum: ['read', 'write'] }).notNull(),
    sqlHash: text('sql_hash').notNull(),
    sqlText: text('sql_text').notNull(),
    durationMs: integer('duration_ms').notNull(),
    rowCount: integer('row_count'),
    truncated: boolean('truncated').notNull().default(false),
    error: text('error'),
    correlationId: text('correlation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('query_run_workspace_idx').on(t.workspaceId, t.createdAt),
    check('query_run_origin_check', inList(t.origin.name, queryOrigins)),
    check('query_run_path_check', inList(t.path.name, queryPaths)),
  ],
);

export type Workspace = typeof workspace.$inferSelect;
export type WorkspaceSettings = typeof workspaceSettings.$inferSelect;
