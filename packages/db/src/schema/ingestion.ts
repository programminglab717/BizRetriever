import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { app } from './base';
import { jobRun } from './jobs';
import { workspace } from './workspace';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

const statusCheck = (name: string, column: string, values: readonly string[]) =>
  check(name, sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`));

/**
 * File bytes for the Postgres storage driver (ADR-013, free hosted preview only). Keys are
 * content-addressed, so the same file uploaded twice is stored once per workspace.
 */
export const storageBlob = app.table('storage_blob', {
  key: text('key').primaryKey(),
  workspaceId: uuid('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
  bytes: bytea('bytes').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ingestionRunStatus = [
  'analyzing',
  'review',
  'revising',
  'applying',
  /** Re-upload: the merge preview is ready for the owner. */
  'merge_review',
  'merging',
  'done',
  'failed',
  'cancelled',
] as const;
export type IngestionRunStatus = (typeof ingestionRunStatus)[number];

export const connectionKinds = [
  'google_sheet',
  'shopify',
  'quickbooks',
  'xero',
  'square',
  'woocommerce',
] as const;
export type ConnectionKind = (typeof connectionKinds)[number];
export const connectionStatus = ['active', 'paused', 'needs_attention', 'disconnected'] as const;
export type ConnectionStatus = (typeof connectionStatus)[number];

/**
 * A linked source (M10, ADR-058): a Google Sheet or a Shopify store a business brings data in from.
 * Each sync is an ordinary import (`ingestion_run.connection_id`). `externalId` is the sheet id or the
 * shop's myshopify domain; `secret` (Shopify's access token) is encrypted with CONNECTOR_SECRET.
 */
export const connection = app.table(
  'connection',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: connectionKinds }).notNull(),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    secret: text('secret'),
    status: text('status', { enum: connectionStatus }).notNull().default('active'),
    /** Bring changes in without asking when nothing needs a person. */
    autoUpdate: boolean('auto_update').notNull().default(true),
    /** Fingerprint of what the last sync fetched: the same again means nothing changed. */
    lastFingerprint: text('last_fingerprint'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    /** A check holds the source until then, so two checks never run at once (cleared when done). */
    syncingUntil: timestamp('syncing_until', { withTimezone: true }),
    lastChangedAt: timestamp('last_changed_at', { withTimezone: true }),
    lastRunId: uuid('last_run_id').references((): AnyPgColumn => ingestionRun.id, {
      onDelete: 'set null',
    }),
    /** Safe to show ("This sheet isn't shared any more"). */
    lastError: text('last_error'),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('connection_external_unique').on(t.workspaceId, t.kind, t.externalId),
    statusCheck('connection_kind_check', 'kind', connectionKinds),
    statusCheck('connection_status_check', 'status', connectionStatus),
  ],
);

/** One import: a set of uploaded files taken from analysis through review to loaded records. */
export const ingestionRun = app.table(
  'ingestion_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['initial', 'reupload'] })
      .notNull()
      .default('initial'),
    status: text('status', { enum: ingestionRunStatus }).notNull().default('analyzing'),
    /** The background job currently working on this run (progress is read from it). */
    jobRunId: uuid('job_run_id').references(() => jobRun.id, { onDelete: 'set null' }),
    /** Safe to show. */
    error: text('error'),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** A re-upload whose merge was undone ("Undo this update"). */
    undoneAt: timestamp('undone_at', { withTimezone: true }),
    /** Brought in from a linked source rather than uploaded by a person. */
    connectionId: uuid('connection_id').references((): AnyPgColumn => connection.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('ingestion_run_workspace_idx').on(t.workspaceId, t.createdAt),
    statusCheck('ingestion_run_status_check', 'status', ingestionRunStatus),
  ],
);

/** An uploaded original. Immutable (ADR-013): the bytes live in storage under `storageKey`. */
export const upload = app.table(
  'upload',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => ingestionRun.id, { onDelete: 'cascade' }),
    /** Order within the run; analysis source ids use it ("f<position>:…"). */
    position: integer('position').notNull(),
    fileName: text('file_name').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    mime: text('mime'),
    sha256: text('sha256').notNull(),
    storageKey: text('storage_key').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('upload_run_position_uq').on(t.runId, t.position),
    index('upload_workspace_idx').on(t.workspaceId, t.createdAt),
  ],
);

/** Column profiles of each detected table (masked; never whole files). */
export const sheetProfile = app.table(
  'sheet_profile',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => ingestionRun.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull(),
    uploadId: uuid('upload_id')
      .notNull()
      .references(() => upload.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    sheetName: text('sheet_name').notNull(),
    profile: jsonb('profile').notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.sourceId] })],
);

export const proposalStatus = ['draft', 'approved', 'superseded'] as const;

/**
 * Versions of the data-model proposal for a run. Every correction or revision creates a new
 * version; the newest draft is what the review screen shows.
 */
export const modelProposal = app.table(
  'model_proposal',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => ingestionRun.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: text('status', { enum: proposalStatus }).notNull().default('draft'),
    origin: text('origin', { enum: ['ai', 'heuristic'] }).notNull(),
    /** The proposal before the owner's corrections (what AI revisions start from). */
    baseProposal: jsonb('base_proposal').notNull(),
    /** The owner's corrections, applied in order to the base. */
    corrections: jsonb('corrections')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Base + corrections: what the review screen shows and what gets applied. */
    proposal: jsonb('proposal').notNull(),
    /** Dry-run results: counts, skipped lines, examples, problems, summary facts and template. */
    review: jsonb('review').notNull(),
    /** "What changed" since the previous version, in plain language. */
    changes: jsonb('changes')
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('model_proposal_run_version_uq').on(t.runId, t.version),
    statusCheck('model_proposal_status_check', 'status', proposalStatus),
  ],
);

/** Per record type, what one import loaded. */
export const loadBatch = app.table(
  'load_batch',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => ingestionRun.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    entityKey: text('entity_key').notNull(),
    rowsIn: integer('rows_in').notNull(),
    inserted: integer('inserted').notNull(),
    merged: integer('merged').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    flagged: integer('flagged').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('load_batch_run_entity_uq').on(t.runId, t.entityKey)],
);

/** Lines that couldn't be brought in, or came in with a problem. Plain-language reasons. */
export const rowIssue = app.table(
  'row_issue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => ingestionRun.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    entityKey: text('entity_key'),
    fieldKey: text('field_key'),
    code: text('code').notNull(),
    fileName: text('file_name').notNull(),
    sheetName: text('sheet_name').notNull(),
    sheetRow: integer('sheet_row').notNull(),
    message: text('message').notNull(),
  },
  (t) => [index('row_issue_run_idx').on(t.runId, t.code)],
);

/** Run-level summary for the data quality report. */
export const qualityReport = app.table('quality_report', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => ingestionRun.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  report: jsonb('report').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A file the business keeps sending us (ADR-043): its header fingerprint, the mapping that was
 * approved for it, and the uploads that fed it. A re-upload with the same fingerprint reuses the
 * mapping, and only records from these uploads can be "missing" from the new file.
 */
export const dataSource = app.table(
  'data_source',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    /** "Online orders 2025-26.xlsx · Website" */
    label: text('label').notNull(),
    fileName: text('file_name').notNull(),
    sheetName: text('sheet_name').notNull(),
    /** Normalised header names in order. */
    signature: text('signature').notNull(),
    /** The approved source mapping (its sourceId is rewritten on reuse). */
    mapping: jsonb('mapping').notNull(),
    uploadIds: jsonb('upload_ids').$type<string[]>().notNull().default([]),
    lastRunId: uuid('last_run_id').references(() => ingestionRun.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('data_source_workspace_idx').on(t.workspaceId),
    unique('data_source_signature_uq').on(t.workspaceId, t.signature, t.sheetName),
  ],
);

/** What a re-upload would change (the merge preview the owner approves). */
export const mergePreview = app.table('merge_preview', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => ingestionRun.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  preview: jsonb('preview').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IngestionRun = typeof ingestionRun.$inferSelect;
export type Upload = typeof upload.$inferSelect;
export type ModelProposalRow = typeof modelProposal.$inferSelect;
