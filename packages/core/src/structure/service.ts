import {
  auditEvent,
  changePlan,
  getAppDb,
  getPool,
  metric,
  migration,
  snapshot,
  user,
  type AppDb,
} from '@bizr/db';
import * as schema from '@bizr/db/schema';
import { getPack } from '@bizr/packs';
import { getLogger } from '@bizr/platform';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

import {
  applyChangePlan,
  DestructiveChangeNotConfirmedError,
  lastVersion,
  loadCatalog,
  runDdl,
  syncCatalog,
  takeSnapshot,
  SNAPSHOT_DAYS,
} from '../change-plan/apply';
import { ChangePlanError, compileChangePlan, type CatalogEntity } from '../change-plan/compile';
import { conversion } from '../change-plan/convert';
import { columnsFor } from '../change-plan/names';
import { catalogDelta, compileRollback } from '../change-plan/rollback';
import { changePlanSchema, type ChangeOp, type ChangePlan } from '../change-plan/schema';
import { bumpDataVersion, currentDashboard, ensureDefaultDashboard } from '../dashboard/service';
import { executeTenantQuery } from '../executor/execute';
import { AvailabilityResolver } from '../semantic/availability';
import { fieldsWithData } from '../semantic/data';
import { buildModel } from '../semantic/model';
import { refreshSemanticCatalog } from '../semantic/service';
import { ident } from '../sql/ident';
import { analyzeTenant } from '../tenancy/provision';
import { requireEditor, type MemberWorkspace } from '../workspaces/service';
import { describeOp, describePlan } from './describe';

/**
 * Changing how the data is organised (PRODUCT_SPEC Journey 6, ADR-044): impact before anything
 * happens, typed confirmation for anything that removes data, a snapshot first, and a change history
 * where the latest change can be undone.
 */

export class StructureError extends Error {}

const tenantOf = (m: MemberWorkspace) => ({
  workspaceId: m.workspace.id,
  tenantSchema: m.workspace.tenantSchema,
});
const fmt = new Intl.NumberFormat('en-US');

async function count(
  member: MemberWorkspace,
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  const r = await executeTenantQuery({
    tenant: tenantOf(member),
    sql,
    params,
    origin: 'system',
    path: 'system',
  });
  return Number(r.rows[0]?.n ?? 0);
}

function compileOrExplain(
  tenantSchema: string,
  catalog: readonly CatalogEntity[],
  plan: ChangePlan,
) {
  const parsed = changePlanSchema.safeParse(plan);
  if (!parsed.success) throw new StructureError('That change isn’t possible.');
  try {
    return compileChangePlan(tenantSchema, catalog, parsed.data);
  } catch (err) {
    if (err instanceof ChangePlanError)
      throw new StructureError(
        `That change isn’t possible: ${err.problems.map((p) => p.replace(/^op \d+ \(\w+\): /, '')).join('; ')}.`,
      );
    throw err;
  }
}

export interface ChangeImpact {
  steps: { text: string; destructive: boolean; details: string[] }[];
  destructive: boolean;
  /** Measures that would stop working, by their names in this workspace. */
  lostMeasures: string[];
  /** Dashboard charts that would stop working. */
  lostTiles: string[];
  /** For destructive changes: what the owner types to confirm. */
  confirmText: string | null;
  /** "Affects 1,280 sales. No measures or dashboard charts change." */
  summary: string;
}

/** Impact, computed by code from the real data (ARCHITECTURE §8). Nothing is changed. */
export async function analyzeChange(
  member: MemberWorkspace,
  plan: ChangePlan,
): Promise<ChangeImpact> {
  const catalog = await loadCatalog(member.workspace.id);
  const compiled = compileOrExplain(member.workspace.tenantSchema, catalog, plan);
  const texts = describePlan(
    plan.ops,
    catalog,
    (c, op) => compileChangePlan(member.workspace.tenantSchema, c, { ops: [op] }).catalog,
  );
  const affected = new Map<string, number>();
  let confirmText: string | null = null;

  const steps: ChangeImpact['steps'] = [];
  for (const [i, op] of plan.ops.entries()) {
    const single = (() => {
      try {
        return compileChangePlan(member.workspace.tenantSchema, catalog, { ops: [op] });
      } catch {
        return null; // depends on an earlier op of the same plan
      }
    })();
    const e = 'entity' in op ? catalog.find((x) => x.key === op.entity) : undefined;
    const f =
      e && 'field' in op && typeof op.field === 'string'
        ? e.fields.find((x) => x.key === op.field)
        : undefined;
    const details: string[] = [];
    const things = (n: number) =>
      `${fmt.format(n)} ${(n === 1 ? e!.label.singular : e!.label.plural).toLowerCase()}`;
    const destructive = Boolean(single?.destructive);
    if (e && single) {
      const table = ident(e.tableName);
      const live = `"_deleted_at" IS NULL`;
      switch (op.op) {
        case 'remove_field': {
          const c = columnsFor(f!);
          const n = await count(
            member,
            `SELECT count(*) AS n FROM ${table} WHERE ${ident(c.value ?? c.ref!)} IS NOT NULL`,
          );
          details.push(
            n
              ? `This removes “${f!.label}” from ${things(n)}. We keep a copy for ${SNAPSHOT_DAYS} days so you can undo.`
              : `No ${e.label.plural.toLowerCase()} have a “${f!.label}” yet.`,
          );
          affected.set(e.key, Math.max(affected.get(e.key) ?? 0, n));
          confirmText ??= f!.label;
          break;
        }
        case 'remove_entity': {
          const n = await count(member, `SELECT count(*) AS n FROM ${table} WHERE ${live}`);
          details.push(
            `This removes all ${things(n)}. We keep a copy for ${SNAPSHOT_DAYS} days so you can undo.`,
          );
          affected.set(e.key, n);
          confirmText ??= e.label.plural;
          break;
        }
        case 'change_field_type': {
          const conv = conversion(
            f!.key,
            f!.type as Exclude<NonNullable<typeof f>['type'], 'reference'>,
            op.type,
          );
          const n = await count(
            member,
            `SELECT count(*) AS n FROM ${table} WHERE ${ident(f!.key)} IS NOT NULL`,
          );
          affected.set(e.key, Math.max(affected.get(e.key) ?? 0, n));
          if (conv && !conv.lossless) {
            const lost = await count(
              member,
              `SELECT count(*) AS n FROM ${table} WHERE ${conv.changes}`,
            );
            details.push(
              lost
                ? `${things(lost)} have a “${f!.label}” that ${f!.type !== 'text' && (op.type === 'integer' || op.type === 'date') ? 'will be rounded' : 'can’t be read this way and will become blank'}. We keep a copy for ${SNAPSHOT_DAYS} days so you can undo.`
                : `Every “${f!.label}” can be read this way; nothing is lost.`,
            );
            if (lost) confirmText ??= f!.label;
          } else details.push('Nothing is lost.');
          break;
        }
        case 'remove_relationship': {
          const n = await count(
            member,
            `SELECT count(*) AS n FROM ${table} WHERE ${ident(columnsFor(f!).fk!)} IS NOT NULL`,
          );
          details.push(
            `${things(n)} lose the link; the name stays as text. We keep a copy for ${SNAPSHOT_DAYS} days so you can undo.`,
          );
          affected.set(e.key, n);
          confirmText ??= f!.label;
          break;
        }
        case 'remove_allowed_values': {
          const n = await count(
            member,
            `SELECT count(*) AS n FROM ${table} WHERE ${ident(f!.key)} = ANY($1::text[])`,
            [op.values],
          );
          if (n) details.push(`${things(n)} keep their value; it just can’t be chosen any more.`);
          break;
        }
        case 'add_field': {
          const n = await count(member, `SELECT count(*) AS n FROM ${table} WHERE ${live}`);
          if (n)
            details.push(
              `Existing ${e.label.plural.toLowerCase()} will have it blank. You can fill it in from a file or by hand.`,
            );
          affected.set(e.key, Math.max(affected.get(e.key) ?? 0, n));
          break;
        }
        default:
          break;
      }
    }
    steps.push({ text: texts[i]!, destructive, details });
  }

  // Measures and charts that need what's removed (availability before vs after, ARCHITECTURE §7).
  const pack = getPack(member.workspace.packId);
  const { present } = await fieldsWithData(tenantOf(member), catalog);
  const still = new Set(
    [...present].filter((ref) => {
      const [ek, fk] = ref.split('.');
      return compiled.catalog.some((x) => x.key === ek && x.fields.some((y) => y.key === fk));
    }),
  );
  const before = new AvailabilityResolver(buildModel(catalog, pack, present));
  const after = new AvailabilityResolver(buildModel(compiled.catalog, pack, still));
  const lostIds = pack.metrics.metrics
    .filter((m) => before.metric(m.id).available && !after.metric(m.id).available)
    .map((m) => m.id);
  const labels = lostIds.length
    ? new Map(
        (
          await getAppDb()
            .select({ key: metric.key, label: metric.label })
            .from(metric)
            .where(and(eq(metric.workspaceId, member.workspace.id), inArray(metric.key, lostIds)))
        ).map((r) => [r.key, r.label]),
      )
    : new Map<string, string>();
  const lostMeasures = lostIds.map((id) => labels.get(id) ?? id);
  const removedRefs = catalog.flatMap((e) =>
    e.fields
      .filter(
        (f) =>
          !compiled.catalog
            .find((x) => x.key === e.key)
            ?.fields.some((y) => y.key === f.key && y.type === f.type),
      )
      .map((f) => `${e.key}.${f.key}`),
  );
  let lostTiles: string[] = [];
  try {
    const dash = await currentDashboard(member);
    lostTiles = dash.tiles
      .filter((t) => {
        const json = JSON.stringify(t.spec);
        return (
          lostIds.some((id) => json.includes(`"${id}"`)) ||
          removedRefs.some((r) => json.includes(`"${r}"`))
        );
      })
      .map((t) => t.title);
  } catch {
    // no dashboard yet
  }

  const total = [...affected.entries()]
    .filter(([, n]) => n > 0)
    .map(([key, n]) => {
      const e = catalog.find((x) => x.key === key)!;
      return `${fmt.format(n)} ${(n === 1 ? e.label.singular : e.label.plural).toLowerCase()}`;
    });
  const lost =
    lostMeasures.length || lostTiles.length
      ? [
          lostMeasures.length ? `${lostMeasures.join(', ')} would stop working.` : '',
          lostTiles.length ? `Dashboard charts affected: ${lostTiles.join(', ')}.` : '',
        ]
          .filter(Boolean)
          .join(' ')
      : 'No measures or dashboard charts change.';
  return {
    steps,
    destructive: compiled.destructive,
    lostMeasures,
    lostTiles,
    confirmText: compiled.destructive ? (confirmText ?? 'remove') : null,
    summary: `${total.length ? `Affects ${total.join(' and ')}. ` : ''}${lost}`,
  };
}

/** After any structural change: statistics, measures, cached tiles, possible new tiles. */
async function afterChange(member: MemberWorkspace, userId: string | null) {
  await analyzeTenant(member.workspace.tenantSchema);
  await refreshSemanticCatalog({
    id: member.workspace.id,
    tenantSchema: member.workspace.tenantSchema,
    packId: member.workspace.packId,
  });
  await bumpDataVersion(member.workspace.id);
  await ensureDefaultDashboard(
    { id: member.workspace.id, packId: member.workspace.packId },
    userId,
  );
}

/** "Make this change". Destructive changes need the typed confirmation text. */
export async function makeStructuralChange(input: {
  member: MemberWorkspace;
  userId: string;
  plan: ChangePlan;
  origin?: 'chat' | 'system';
  /** What the owner typed, for destructive changes. */
  confirmation?: string;
}): Promise<{ version: number }> {
  requireEditor(input.member);
  const { member } = input;
  const impact = await analyzeChange(member, input.plan);
  const confirmed =
    !impact.destructive ||
    (input.confirmation ?? '').trim().toLowerCase() ===
      (impact.confirmText ?? '').trim().toLowerCase();
  if (!confirmed) throw new StructureError(`To confirm, type “${impact.confirmText}”.`);
  try {
    const r = await applyChangePlan({
      workspace: { id: member.workspace.id, tenantSchema: member.workspace.tenantSchema },
      plan: input.plan,
      origin: input.origin ?? 'chat',
      userId: input.userId,
      destructiveConfirmed: impact.destructive && confirmed,
      alsoInTransaction: async (tx) => {
        await tx.insert(auditEvent).values({
          workspaceId: member.workspace.id,
          userId: input.userId,
          action: 'structure.changed',
          details: { plan: input.plan, impact: impact.summary },
        });
      },
    });
    await afterChange(member, input.userId);
    return { version: r.version };
  } catch (err) {
    if (err instanceof ChangePlanError)
      throw new StructureError('That change isn’t possible any more. Please try again.');
    if (err instanceof DestructiveChangeNotConfirmedError) throw new StructureError(err.message);
    throw err;
  }
}

// --- History and undo ----------------------------------------------------------------------------

export interface ChangeEntry {
  version: number;
  at: Date;
  by: string | null;
  origin: 'ingestion' | 'chat' | 'system';
  steps: string[];
  destructive: boolean;
  /** This change undid version N. */
  undoes: number | null;
  undone: boolean;
  /** Only the latest change can be undone (and not the first set-up from your files). */
  canUndo: boolean;
}

export async function listChanges(member: MemberWorkspace, limit = 50): Promise<ChangeEntry[]> {
  const db = getAppDb();
  const rows = await db
    .select({
      version: migration.version,
      at: migration.appliedAt,
      plan: changePlan.plan,
      origin: changePlan.origin,
      destructive: migration.destructive,
      undoes: migration.undoesVersion,
      rolledBackAt: migration.rolledBackAt,
      catalogBefore: migration.catalogBefore,
      by: user.name,
    })
    .from(migration)
    .innerJoin(changePlan, eq(changePlan.id, migration.changePlanId))
    .leftJoin(user, eq(user.id, migration.createdBy))
    .where(eq(migration.workspaceId, member.workspace.id))
    .orderBy(desc(migration.version))
    .limit(limit);
  const latest = rows[0];
  return rows.map((r) => {
    const plan = r.plan as ChangePlan;
    const before = (r.catalogBefore as CatalogEntity[] | null) ?? [];
    let steps: string[];
    try {
      steps = describePlan(
        plan.ops,
        before,
        (c, op) => compileChangePlan(member.workspace.tenantSchema, c, { ops: [op] }).catalog,
      );
    } catch {
      steps = plan.ops.map((op) => describeOp(op, before));
    }
    if (r.undoes !== null) steps = [`Undid change ${r.undoes}`];
    return {
      version: r.version,
      at: r.at,
      by: r.by ?? null,
      origin: r.origin,
      steps,
      destructive: r.destructive,
      undoes: r.undoes,
      undone: r.rolledBackAt !== null,
      canUndo:
        r === latest &&
        r.origin !== 'ingestion' &&
        r.undoes === null &&
        r.rolledBackAt === null &&
        r.catalogBefore !== null,
    };
  });
}

export interface UndoPreview {
  version: number;
  steps: string[];
  /** Concrete consequences, when undoing would lose data entered since. */
  warnings: string[];
  needsConfirmation: boolean;
}

async function rollbackFor(member: MemberWorkspace, version: number, db: AppDb = getAppDb()) {
  const [m] = await db
    .select()
    .from(migration)
    .innerJoin(changePlan, eq(changePlan.id, migration.changePlanId))
    .where(and(eq(migration.workspaceId, member.workspace.id), eq(migration.version, version)));
  if (!m) throw new StructureError('We couldn’t find that change.');
  if (m.migration.version !== (await lastVersion(db, member.workspace.id)))
    throw new StructureError('Only the latest change can be undone. Undo the later ones first.');
  if (
    m.change_plan.origin === 'ingestion' ||
    m.migration.undoesVersion !== null ||
    m.migration.rolledBackAt ||
    !m.migration.catalogBefore
  )
    throw new StructureError('This change can’t be undone here.');
  const [snap] = await db
    .select()
    .from(snapshot)
    .where(and(eq(snapshot.migrationId, m.migration.id), isNull(snapshot.droppedAt)));
  const now = await loadCatalog(member.workspace.id, db);
  const before = m.migration.catalogBefore as CatalogEntity[];
  const forward = m.change_plan.plan as ChangePlan;
  let compiled;
  try {
    compiled = compileRollback({
      tenantSchema: member.workspace.tenantSchema,
      now,
      before,
      forward,
      snapshots: snap
        ? Object.fromEntries(snap.objects.map((o) => [o.table, o.snapshotTable]))
        : null,
    });
  } catch (err) {
    if (err instanceof ChangePlanError)
      throw new StructureError(`This change can’t be undone: ${err.problems.join('; ')}.`);
    throw err;
  }
  return { m, now, before, forward, compiled, appliedAt: m.migration.appliedAt };
}

/** What undoing a change would do, in concrete numbers (PRODUCT_SPEC Journey 6). */
export async function previewUndo(member: MemberWorkspace, version: number): Promise<UndoPreview> {
  const { now, before, compiled, appliedAt } = await rollbackFor(member, version);
  const warnings: string[] = [];
  const label = (table: string) => {
    const e = [...now, ...before].find((x) => x.tableName === table);
    return e ? e.label.plural.toLowerCase() : 'records';
  };
  for (const r of compiled.restores) {
    const added = await count(
      member,
      `SELECT count(*) AS n FROM ${ident(r.table)} WHERE "_created_at" > $1::timestamptz`,
      [appliedAt.toISOString()],
    ).catch(() => 0);
    if (r.wholeTable)
      warnings.push(`All ${label(r.table)} come back as they were when the change was made.`);
    else if (added)
      warnings.push(
        `${fmt.format(added)} ${label(r.table)} added since the change won’t get the restored details back; they stay blank.`,
      );
  }
  for (const s of compiled.steps.filter((x) => x.how === 'inverse' && x.destructive)) {
    const op = s.op;
    const e = 'entity' in op ? now.find((x) => x.key === op.entity) : undefined;
    if (!e) continue;
    if (op.op === 'remove_field') {
      const f = e.fields.find((x) => x.key === op.field);
      if (!f) continue;
      const c = columnsFor(f);
      const n = await count(
        member,
        `SELECT count(*) AS n FROM ${ident(e.tableName)} WHERE ${ident(c.value ?? c.ref!)} IS NOT NULL`,
      );
      if (n)
        warnings.push(
          `${fmt.format(n)} ${e.label.plural.toLowerCase()} have a “${f.label}” filled in since; undoing removes it.`,
        );
    } else if (op.op === 'remove_entity') {
      const n = await count(member, `SELECT count(*) AS n FROM ${ident(e.tableName)}`);
      if (n)
        warnings.push(
          `Undoing removes all ${fmt.format(n)} ${e.label.plural.toLowerCase()} added since.`,
        );
    } else if (op.op === 'change_field_type') {
      warnings.push(
        `Some “${e.fields.find((x) => x.key === op.field)?.label ?? op.field}” values entered since may be rounded or become blank.`,
      );
    }
  }
  return {
    version,
    steps: compiled.steps.map((s) => describeOp(s.op, s.how === 'inverse' ? now : before)),
    warnings,
    needsConfirmation: warnings.length > 0,
  };
}

/** Undo the latest change: inverse ops, or the snapshot for what the change removed. One transaction. */
export async function undoStructuralChange(input: {
  member: MemberWorkspace;
  userId: string;
  version: number;
  confirmed?: boolean;
}): Promise<{ version: number }> {
  requireEditor(input.member);
  const { member } = input;
  const preview = await previewUndo(member, input.version);
  if (preview.needsConfirmation && !input.confirmed)
    throw new StructureError('Undoing this would lose data entered since. Please confirm.');

  const client = await getPool('admin').connect();
  const tx = drizzle(client, { schema });
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `bizr-ws:${member.workspace.id}`,
    ]);
    const { m, now, forward, compiled } = await rollbackFor(member, input.version, tx);
    const version = (await lastVersion(tx, member.workspace.id)) + 1;
    const snapshotObjects = compiled.snapshotTables.length
      ? await takeSnapshot(client, member.workspace.tenantSchema, compiled.snapshotTables, version)
      : [];
    await runDdl(client, member.workspace.tenantSchema, now, compiled.statements, compiled.catalog);
    const [planRow] = await tx
      .insert(changePlan)
      .values({
        workspaceId: member.workspace.id,
        origin: 'system',
        plan: { ops: compiled.steps.map((s) => s.op) satisfies ChangeOp[] },
        status: 'applied',
        createdBy: input.userId,
        confirmedBy: input.userId,
        confirmedAt: new Date(),
        appliedAt: new Date(),
      })
      .returning({ id: changePlan.id });
    const [row] = await tx
      .insert(migration)
      .values({
        workspaceId: member.workspace.id,
        version,
        changePlanId: planRow!.id,
        statements: compiled.statements,
        inversePlan: forward,
        destructive: compiled.snapshotTables.length > 0,
        lossyRollback: true,
        catalogBefore: now,
        undoesVersion: m.migration.version,
        createdBy: input.userId,
      })
      .returning({ id: migration.id });
    if (snapshotObjects.length)
      await tx.insert(snapshot).values({
        workspaceId: member.workspace.id,
        migrationId: row!.id,
        objects: snapshotObjects,
        expiresAt: new Date(Date.now() + SNAPSHOT_DAYS * 86_400_000),
      });
    await tx
      .update(migration)
      .set({ rolledBackAt: new Date() })
      .where(eq(migration.id, m.migration.id));
    await syncCatalog(tx, member.workspace.id, {
      catalog: compiled.catalog,
      delta: catalogDelta(now, compiled.catalog),
    });
    await tx.insert(auditEvent).values({
      workspaceId: member.workspace.id,
      userId: input.userId,
      action: 'structure.undone',
      details: { version: m.migration.version },
    });
    await client.query('COMMIT');
    getLogger('structure').info(
      { workspaceId: member.workspace.id, undid: m.migration.version, version },
      'change undone',
    );
    await afterChange(member, input.userId);
    return { version };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
