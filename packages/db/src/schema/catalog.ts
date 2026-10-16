import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { app } from './base';
import { workspace } from './workspace';

/**
 * The semantic catalog of each tenant's data (ARCHITECTURE §7): what record types exist, their
 * details (fields) and links. Written only by the change-plan applier, in the same transaction as the
 * DDL it describes.
 */
export const entity = app.table(
  'entity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    tableName: text('table_name').notNull(),
    labelSingular: text('label_singular').notNull(),
    labelPlural: text('label_plural').notNull(),
    description: text('description').notNull().default(''),
    /** Pack entity id, or null for custom record types. */
    packEntity: text('pack_entity'),
    naturalKeys: jsonb('natural_keys')
      .$type<string[][]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    timeField: text('time_field'),
    /** Records of this type (refreshed after each import). */
    recordCount: integer('record_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('entity_workspace_key_uq').on(t.workspaceId, t.key),
    unique('entity_workspace_table_uq').on(t.workspaceId, t.tableName),
  ],
);

export const field = app.table(
  'field',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entity.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: text('type').notNull(),
    semantic: text('semantic'),
    required: boolean('required').notNull().default(false),
    pii: boolean('pii').notNull().default(false),
    description: text('description'),
    allowedValues: jsonb('allowed_values').$type<string[]>(),
    /** Target entity key for reference fields. */
    referencesEntity: text('references_entity'),
    packField: text('pack_field'),
    /** Words the owner uses for this (their column headers), for question answering. */
    synonyms: jsonb('synonyms')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    position: integer('position').notNull(),
    /** True when at least one record has a value (refreshed after each import; drives availability). */
    hasData: boolean('has_data').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('field_entity_key_uq').on(t.entityId, t.key)],
);

export const changePlanStatus = ['draft', 'confirmed', 'applied', 'rejected', 'failed'] as const;

export const changePlan = app.table(
  'change_plan',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    origin: text('origin', { enum: ['ingestion', 'chat', 'system'] }).notNull(),
    plan: jsonb('plan').notNull(),
    impact: jsonb('impact'),
    status: text('status', { enum: changePlanStatus }).notNull().default('draft'),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    confirmedBy: uuid('confirmed_by').references(() => user.id, { onDelete: 'set null' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('change_plan_workspace_idx').on(t.workspaceId, t.createdAt),
    check(
      'change_plan_status_check',
      sql.raw(`status in (${changePlanStatus.map((s) => `'${s}'`).join(', ')})`),
    ),
  ],
);

/** Every structural change applied to a tenant schema, in order (user-visible as "Change history"). */
export const migration = app.table(
  'migration',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    changePlanId: uuid('change_plan_id')
      .notNull()
      .references(() => changePlan.id, { onDelete: 'cascade' }),
    statements: jsonb('statements').$type<string[]>().notNull(),
    inversePlan: jsonb('inverse_plan'),
    destructive: boolean('destructive').notNull().default(false),
    lossyRollback: boolean('lossy_rollback').notNull().default(false),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
    rolledBackAt: timestamp('rolled_back_at', { withTimezone: true }),
  },
  (t) => [unique('migration_workspace_version_uq').on(t.workspaceId, t.version)],
);

/**
 * The measures a workspace has (ARCHITECTURE §7): seeded from its pack, with availability computed
 * from which details hold data. `label` can be renamed by the owner; the definition can't.
 */
export const metric = app.table(
  'metric',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    /** Pack metric id, or null for custom measures (later). */
    packMetric: text('pack_metric'),
    label: text('label').notNull(),
    /** True once the owner renamed it (refreshes keep their name). */
    labelCustomized: boolean('label_customized').notNull().default(false),
    description: text('description').notNull(),
    format: text('format').notNull(),
    goodDirection: text('good_direction').notNull().default('up'),
    snapshot: boolean('snapshot').notNull().default(false),
    available: boolean('available').notNull().default(false),
    unavailableReason: text('unavailable_reason'),
    missing: jsonb('missing')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    position: integer('position').notNull(),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('metric_workspace_key_uq').on(t.workspaceId, t.key)],
);

export type MetricRow = typeof metric.$inferSelect;
export type EntityRow = typeof entity.$inferSelect;
export type FieldRow = typeof field.$inferSelect;
