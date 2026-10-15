import { changePlan, entity, field, getAppDb, getPool, migration, type AppDb } from '@bizr/db';
import * as schema from '@bizr/db/schema';
import { getLogger } from '@bizr/platform';
import { and, asc, eq, inArray, max } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

import { compileChangePlan, type CatalogEntity, type CompiledPlan } from './compile';
import type { ChangePlan, FieldDef } from './schema';

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

    for (const statement of compiled.statements) await client.query(statement);

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
    const [{ current: lastVersion } = { current: 0 }] = await tx
      .select({ current: max(migration.version) })
      .from(migration)
      .where(eq(migration.workspaceId, options.workspace.id));
    const version = (lastVersion ?? 0) + 1;
    await tx.insert(migration).values({
      workspaceId: options.workspace.id,
      version,
      changePlanId: planRow!.id,
      statements: compiled.statements,
      inversePlan: compiled.inverse,
      destructive: compiled.destructive,
      lossyRollback: compiled.inverse === null,
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

async function syncCatalog(tx: AppDb, workspaceId: string, compiled: CompiledPlan): Promise<void> {
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
