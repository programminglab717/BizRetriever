import {
  changePlan,
  entity,
  field,
  getAppDb,
  getPool,
  migration,
  snapshot,
  type AppDb,
} from '@bizr/db';
import * as schema from '@bizr/db/schema';
import { getLogger } from '@bizr/platform';
import { and, asc, eq, inArray, max } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

import type { PoolClient } from 'pg';

import { qualified } from '../sql/ident';
import { compileChangePlan, type CatalogEntity, type CompiledPlan } from './compile';
import type { ChangePlan, FieldDef } from './schema';
import { createViewStatements, dropViewStatements } from './views';

export interface TenantWorkspace {
  id: string;
  tenantSchema: string;
}

/** The tenant's current catalog, as the compiler sees it. */
export async function loadCatalog(
  workspaceId: string,
  db: AppDb = getAppDb(),
): Promise<CatalogEntity[]> {
  const entities = await db
    .select()
    .from(entity)
    .where(eq(entity.workspaceId, workspaceId))
    .orderBy(asc(entity.createdAt), asc(entity.key));
  if (entities.length === 0) return [];
  const fields = await db
    .select()
    .from(field)
    .where(
      inArray(
        field.entityId,
        entities.map((e) => e.id),
      ),
    )
    .orderBy(asc(field.position));
  return entities.map((e) => ({
    key: e.key,
    tableName: e.tableName,
    label: { singular: e.labelSingular, plural: e.labelPlural },
    description: e.description,
    naturalKeys: e.naturalKeys,
    timeField: e.timeField ?? undefined,
    packEntity: e.packEntity ?? undefined,
    fields: fields
      .filter((f) => f.entityId === e.id)
      .map((f) => {
        const def: FieldDef = {
          key: f.key,
          label: f.label,
          type: f.type as FieldDef['type'],
          required: f.required,
          pii: f.pii,
        };
        if (f.semantic) def.semantic = f.semantic as NonNullable<FieldDef['semantic']>;
        if (f.description) def.description = f.description;
        if (f.allowedValues) def.allowedValues = f.allowedValues;
        if (f.referencesEntity) def.references = f.referencesEntity;
        if (f.packField) def.packField = f.packField;
        return def;
      }),
  }));
}

export class DestructiveChangeNotConfirmedError extends Error {}

export interface ApplyResult {
  changePlanId: string;
  version: number;
  compiled: CompiledPlan;
}

/**
 * Compiles and applies a change plan: the tenant DDL and the catalog/migration records commit in ONE
 * transaction on the admin connection, so the catalog can never disagree with the real tables.
 * Concurrent changes to the same workspace are serialised with an advisory lock.
 */
export async function applyChangePlan(options: {
  workspace: TenantWorkspace;
  plan: ChangePlan;
  origin: 'ingestion' | 'chat' | 'system';
  userId?: string | null;
  /** Required for plans that drop anything (safety rule 3). Snapshots arrive with M6. */
  destructiveConfirmed?: boolean;
  /** Extra writes to run inside the same transaction (e.g. ingestion bookkeeping). */
  alsoInTransaction?: (tx: AppDb) => Promise<void>;
}): Promise<ApplyResult> {
  const client = await getPool('admin').connect();
  const tx = drizzle(client, { schema });
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `bizr-ws:${options.workspace.id}`,
    ]);

    const current = await loadCatalog(options.workspace.id, tx);
    const compiled = compileChangePlan(options.workspace.tenantSchema, current, options.plan);
    if (compiled.destructive && !options.destructiveConfirmed) {
      throw new DestructiveChangeNotConfirmedError(
        'This change removes data and needs explicit confirmation',
      );
    }

    const version = (await lastVersion(tx, options.workspace.id)) + 1;
    // Safety rule 3: copy what a destructive change touches before running it.
    const snapshotObjects = compiled.destructive
      ? await takeSnapshot(client, options.workspace.tenantSchema, compiled.snapshotTables, version)
      : [];
    await runDdl(
      client,
      options.workspace.tenantSchema,
      current,
      compiled.statements,
      compiled.catalog,
    );

    const [planRow] = await tx
      .insert(changePlan)
      .values({
        workspaceId: options.workspace.id,
        origin: options.origin,
        plan: options.plan,
        status: 'applied',
        createdBy: options.userId ?? null,
        confirmedBy: options.userId ?? null,
        confirmedAt: new Date(),
        appliedAt: new Date(),
      })
      .returning({ id: changePlan.id });
    const [migrationRow] = await tx
      .insert(migration)
      .values({
        workspaceId: options.workspace.id,
        version,
        changePlanId: planRow!.id,
        statements: compiled.statements,
        inversePlan: compiled.inverse,
        destructive: compiled.destructive,
        lossyRollback: compiled.inverse === null,
        catalogBefore: current,
        createdBy: options.userId ?? null,
      })
      .returning({ id: migration.id });
    if (snapshotObjects.length > 0)
      await tx.insert(snapshot).values({
        workspaceId: options.workspace.id,
        migrationId: migrationRow!.id,
        objects: snapshotObjects,
        expiresAt: new Date(Date.now() + SNAPSHOT_DAYS * 86_400_000),
      });

    await syncCatalog(tx, options.workspace.id, compiled);
    if (options.alsoInTransaction) await options.alsoInTransaction(tx);
    await client.query('COMMIT');
    getLogger('change-plan').info(
      { workspaceId: options.workspace.id, version, statements: compiled.statements.length },
      'change plan applied',
    );
    return { changePlanId: planRow!.id, version, compiled };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export const SNAPSHOT_DAYS = 30;

export async function lastVersion(tx: AppDb, workspaceId: string): Promise<number> {
  const [{ current } = { current: 0 }] = await tx
    .select({ current: max(migration.version) })
    .from(migration)
    .where(eq(migration.workspaceId, workspaceId));
  return current ?? 0;
}

/** Copies tables into `<schema>_snap` as `<table>__v<version>` (ADR-023). Same transaction. */
export async function takeSnapshot(
  client: PoolClient,
  tenantSchema: string,
  tables: readonly string[],
  version: number,
): Promise<{ table: string; snapshotTable: string; rows: number }[]> {
  const out: { table: string; snapshotTable: string; rows: number }[] = [];
  for (const table of tables) {
    const snapshotTable = `${table}__v${version}`;
    const target = qualified(`${tenantSchema}_snap`, snapshotTable);
    await client.query(`DROP TABLE IF EXISTS ${target}`);
    const r = await client.query(
      `CREATE TABLE ${target} AS TABLE ${qualified(tenantSchema, table)}`,
    );
    out.push({ table, snapshotTable, rows: r.rowCount ?? 0 });
  }
  return out;
}

/** Views depend on the tables: drop them first, run the DDL, rebuild them from the new catalog. */
export async function runDdl(
  client: PoolClient,
  tenantSchema: string,
  before: readonly CatalogEntity[],
  statements: readonly string[],
  after: readonly CatalogEntity[],
): Promise<void> {
  for (const s of dropViewStatements(tenantSchema, before)) await client.query(s);
  for (const statement of statements) await client.query(statement);
  for (const s of createViewStatements(tenantSchema, after)) await client.query(s);
}

export async function syncCatalog(
  tx: AppDb,
  workspaceId: string,
  compiled: Pick<CompiledPlan, 'catalog' | 'delta'>,
): Promise<void> {
  const byKey = new Map(compiled.catalog.map((e) => [e.key, e]));
  if (compiled.delta.removedEntities.length > 0) {
    await tx
      .delete(entity)
      .where(
        and(
          eq(entity.workspaceId, workspaceId),
          inArray(entity.key, compiled.delta.removedEntities),
        ),
      );
  }
  for (const key of compiled.delta.createdEntities) {
    const e = byKey.get(key)!;
    const [row] = await tx
      .insert(entity)
      .values({
        workspaceId,
        key: e.key,
        tableName: e.tableName,
        labelSingular: e.label.singular,
        labelPlural: e.label.plural,
        description: e.description,
        packEntity: e.packEntity ?? null,
        naturalKeys: e.naturalKeys,
        timeField: e.timeField ?? null,
      })
      .returning({ id: entity.id });
    if (e.fields.length > 0) {
      await tx.insert(field).values(e.fields.map((f, i) => fieldRow(row!.id, f, i)));
    }
  }
  const entityIds = new Map(
    (
      await tx
        .select({ id: entity.id, key: entity.key })
        .from(entity)
        .where(eq(entity.workspaceId, workspaceId))
    ).map((r) => [r.key, r.id]),
  );
  for (const { entity: key, field: fieldKey } of compiled.delta.addedFields) {
    const e = byKey.get(key)!;
    const position = e.fields.findIndex((f) => f.key === fieldKey);
    await tx.insert(field).values(fieldRow(entityIds.get(key)!, e.fields[position]!, position));
  }
  for (const { entity: key, field: fieldKey } of compiled.delta.removedFields) {
    await tx
      .delete(field)
      .where(and(eq(field.entityId, entityIds.get(key)!), eq(field.key, fieldKey)));
  }
  for (const key of compiled.delta.changedEntities) {
    const e = byKey.get(key);
    if (!e) continue;
    await tx
      .update(entity)
      .set({ labelSingular: e.label.singular, labelPlural: e.label.plural })
      .where(and(eq(entity.workspaceId, workspaceId), eq(entity.key, key)));
  }
  // Changed details keep their row (and what profiling learned about them).
  for (const { entity: key, field: fieldKey } of compiled.delta.changedFields) {
    const f = byKey.get(key)?.fields.find((x) => x.key === fieldKey);
    if (!f || !entityIds.has(key)) continue;
    await tx
      .update(field)
      .set({
        label: f.label,
        type: f.type,
        allowedValues: f.allowedValues ?? null,
        referencesEntity: f.references ?? null,
      })
      .where(and(eq(field.entityId, entityIds.get(key)!), eq(field.key, fieldKey)));
  }
}

function fieldRow(entityId: string, f: FieldDef, position: number) {
  return {
    entityId,
    key: f.key,
    label: f.label,
    type: f.type,
    semantic: f.semantic ?? null,
    required: f.required,
    pii: f.pii,
    description: f.description ?? null,
    allowedValues: f.allowedValues ?? null,
    referencesEntity: f.references ?? null,
    packField: f.packField ?? null,
    position,
  };
}
