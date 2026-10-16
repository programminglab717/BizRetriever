import { auditEvent, entity, field, getAppDb, metric, type QueryOrigin } from '@bizr/db';
import { getPack, type PackData } from '@bizr/packs';
import { getLogger } from '@bizr/platform';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { loadCatalog } from '../change-plan/apply';
import { executeTenantQuery } from '../executor/execute';
import type { MemberWorkspace } from '../workspaces/service';
import { AvailabilityResolver } from './availability';
import { compileQuery, type CompiledQuery, type ResultColumn } from './compile';
import { fieldsWithData, topValues } from './data';
import { buildModel, type CompileContext, type SemanticModel } from './model';
import type { QuerySpecInput } from './query-spec';

/** The semantic layer for the web app and jobs (ARCHITECTURE §7). */

interface WorkspaceRef {
  id: string;
  tenantSchema: string;
  packId: string;
}

const log = () => getLogger('semantic');

/** The pack, with the owner's renamed measure labels applied. */
function packWithLabels(pack: PackData, labels: ReadonlyMap<string, string>): PackData {
  return {
    ...pack,
    metrics: {
      ...pack.metrics,
      metrics: pack.metrics.metrics.map((m) => ({ ...m, label: labels.get(m.id) ?? m.label })),
    },
  };
}

/**
 * Recomputes which details hold data, record counts and every measure's availability. Run after each
 * import (and any change to the data's structure). Owner renames are kept.
 */
export async function refreshSemanticCatalog(
  ws: WorkspaceRef,
): Promise<{ available: number; unavailable: number }> {
  const pack = getPack(ws.packId);
  const catalog = await loadCatalog(ws.id);
  const { present, counts } = await fieldsWithData(
    { workspaceId: ws.id, tenantSchema: ws.tenantSchema },
    catalog,
  );
  const model = buildModel(catalog, pack, present);
  const values = await topValues(
    { workspaceId: ws.id, tenantSchema: ws.tenantSchema },
    catalog,
    pack.metrics.dimensions.map((d) => d.field).filter((f) => present.has(f)),
  );
  const resolver = new AvailabilityResolver(model);
  const db = getAppDb();
  let available = 0;
  await db.transaction(async (tx) => {
    const entities = await tx.select().from(entity).where(eq(entity.workspaceId, ws.id));
    for (const e of entities) {
      await tx
        .update(entity)
        .set({ recordCount: counts.get(e.key) ?? 0 })
        .where(eq(entity.id, e.id));
      const fields = catalog.find((c) => c.key === e.key)?.fields ?? [];
      const withData = fields.filter((f) => present.has(`${e.key}.${f.key}`)).map((f) => f.key);
      await tx.update(field).set({ hasData: false, topValues: [] }).where(eq(field.entityId, e.id));
      for (const [ref, list] of values) {
        const [entityKey, fieldKey] = ref.split('.');
        if (entityKey !== e.key) continue;
        await tx
          .update(field)
          .set({ topValues: list })
          .where(and(eq(field.entityId, e.id), eq(field.key, fieldKey!)));
      }
      if (withData.length)
        await tx
          .update(field)
          .set({ hasData: true })
          .where(and(eq(field.entityId, e.id), inArray(field.key, withData)));
    }
    for (const [i, m] of pack.metrics.metrics.entries()) {
      const a = resolver.metric(m.id);
      if (a.available) available += 1;
      const values = {
        description: m.description,
        format: m.format,
        goodDirection: m.good_direction,
        snapshot: m.snapshot,
        available: a.available,
        unavailableReason: a.available ? null : a.reason,
        missing: a.available ? [] : a.missing,
        position: i,
        refreshedAt: new Date(),
      };
      await tx
        .insert(metric)
        .values({ workspaceId: ws.id, key: m.id, packMetric: m.id, label: m.label, ...values })
        .onConflictDoUpdate({
          target: [metric.workspaceId, metric.key],
          set: {
            ...values,
            label: sql`CASE WHEN ${metric.labelCustomized} THEN ${metric.label} ELSE ${m.label} END`,
          },
        });
    }
  });
  const unavailable = pack.metrics.metrics.length - available;
  log().info({ workspaceId: ws.id, available, unavailable }, 'semantic catalog refreshed');
  return { available, unavailable };
}

/** The compiler's view of a workspace, from the stored catalog (no tenant queries). */
export async function loadSemanticModel(ws: WorkspaceRef): Promise<SemanticModel> {
  const db = getAppDb();
  const catalog = await loadCatalog(ws.id);
  const withData = await db
    .select({ entity: entity.key, field: field.key })
    .from(field)
    .innerJoin(entity, eq(entity.id, field.entityId))
    .where(and(eq(entity.workspaceId, ws.id), eq(field.hasData, true)));
  const labels = await db
    .select({ key: metric.key, label: metric.label })
    .from(metric)
    .where(eq(metric.workspaceId, ws.id));
  return buildModel(
    catalog,
    packWithLabels(getPack(ws.packId), new Map(labels.map((l) => [l.key, l.label]))),
    new Set(withData.map((r) => `${r.entity}.${r.field}`)),
  );
}

export function compileContext(
  member: Pick<MemberWorkspace, 'settings'>,
  now = new Date(),
): CompileContext {
  const s = member.settings;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: s.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return {
    timezone: s.timezone,
    weekStart: s.weekStart,
    fiscalYearStartMonth: s.fiscalYearStartMonth,
    today,
  };
}

export interface QueryResult {
  /** The SQL that ran (shown under "Details"). */
  sql: string;
  columns: ResultColumn[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  assumptions: string[];
  period: CompiledQuery['period'];
  previousPeriod?: CompiledQuery['previousPeriod'];
}

/** Compiles and runs a query spec for a member's workspace, as its reader role. */
export async function runQuery(
  member: MemberWorkspace,
  spec: QuerySpecInput,
  origin: QueryOrigin,
  model?: SemanticModel,
): Promise<QueryResult> {
  const ws = member.workspace;
  const m = model ?? (await loadSemanticModel(ws));
  const q = compileQuery(m, spec, compileContext(member));
  const r = await executeTenantQuery({
    tenant: { workspaceId: ws.id, tenantSchema: ws.tenantSchema },
    sql: q.sql,
    params: q.params,
    origin,
    path: 'spec',
    timeoutMs: 15_000,
  });
  return {
    sql: q.sql,
    columns: q.columns,
    rows: r.rows,
    truncated: r.truncated,
    assumptions: q.assumptions,
    period: q.period,
    ...(q.previousPeriod ? { previousPeriod: q.previousPeriod } : {}),
  };
}

// --- "What we track" --------------------------------------------------------------------------

export interface Glossary {
  measures: {
    key: string;
    label: string;
    description: string;
    format: string;
    available: boolean;
    reason: string | null;
    assumptions: string[];
  }[];
  recordTypes: {
    key: string;
    singular: string;
    plural: string;
    description: string;
    count: number;
    details: { key: string; label: string; hasData: boolean; isLink: boolean }[];
    links: string[];
  }[];
}

export async function getGlossary(member: MemberWorkspace): Promise<Glossary> {
  const db = getAppDb();
  const ws = member.workspace;
  const pack = getPack(ws.packId);
  const measures = await db
    .select()
    .from(metric)
    .where(eq(metric.workspaceId, ws.id))
    .orderBy(asc(metric.position));
  const entities = await db
    .select()
    .from(entity)
    .where(eq(entity.workspaceId, ws.id))
    .orderBy(asc(entity.createdAt), asc(entity.key));
  const fields = entities.length
    ? await db
        .select()
        .from(field)
        .where(
          inArray(
            field.entityId,
            entities.map((e) => e.id),
          ),
        )
        .orderBy(asc(field.position))
    : [];
  const byKey = new Map(entities.map((e) => [e.key, e]));
  return {
    measures: measures.map((m) => ({
      key: m.key,
      label: m.label,
      description: m.description,
      format: m.format,
      available: m.available,
      reason: m.unavailableReason,
      assumptions: pack.metrics.metrics.find((p) => p.id === m.packMetric)?.assumptions ?? [],
    })),
    recordTypes: entities.map((e) => {
      const own = fields.filter((f) => f.entityId === e.id);
      return {
        key: e.key,
        singular: e.labelSingular,
        plural: e.labelPlural,
        description: e.description,
        count: e.recordCount,
        details: own.map((f) => ({
          key: f.key,
          label: f.label,
          hasData: f.hasData,
          isLink: f.type === 'reference',
        })),
        links: own
          .filter((f) => f.type === 'reference' && f.hasData && f.referencesEntity)
          .map((f) => {
            const t = byKey.get(f.referencesEntity!);
            return t ? `${e.labelPlural} are linked to ${t.labelPlural.toLowerCase()}` : undefined;
          })
          .filter((x): x is string => Boolean(x)),
      };
    }),
  };
}

export type RenameTarget =
  | { kind: 'measure'; key: string; label: string }
  | { kind: 'recordType'; key: string; singular: string; plural: string }
  | { kind: 'detail'; recordType: string; key: string; label: string };

export class RenameError extends Error {}

const cleanLabel = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Renames what the owner sees. Metadata only: no data or structure changes. */
export async function renameLabel(
  member: MemberWorkspace,
  userId: string,
  target: RenameTarget,
): Promise<void> {
  const ws = member.workspace;
  const db = getAppDb();
  const check = (label: string) => {
    const l = cleanLabel(label);
    if (l.length < 1 || l.length > 60) throw new RenameError('Names need 1 to 60 characters.');
    return l;
  };
  await db.transaction(async (tx) => {
    if (target.kind === 'measure') {
      const label = check(target.label);
      const r = await tx
        .update(metric)
        .set({ label, labelCustomized: true })
        .where(and(eq(metric.workspaceId, ws.id), eq(metric.key, target.key)))
        .returning({ id: metric.id });
      if (r.length === 0) throw new RenameError('We couldn’t find that measure.');
    } else if (target.kind === 'recordType') {
      const r = await tx
        .update(entity)
        .set({ labelSingular: check(target.singular), labelPlural: check(target.plural) })
        .where(and(eq(entity.workspaceId, ws.id), eq(entity.key, target.key)))
        .returning({ id: entity.id });
      if (r.length === 0) throw new RenameError('We couldn’t find that type of record.');
    } else {
      const [e] = await tx
        .select({ id: entity.id })
        .from(entity)
        .where(and(eq(entity.workspaceId, ws.id), eq(entity.key, target.recordType)));
      if (!e) throw new RenameError('We couldn’t find that type of record.');
      const r = await tx
        .update(field)
        .set({ label: check(target.label) })
        .where(and(eq(field.entityId, e.id), eq(field.key, target.key)))
        .returning({ id: field.id });
      if (r.length === 0) throw new RenameError('We couldn’t find that detail.');
    }
    await tx.insert(auditEvent).values({
      workspaceId: ws.id,
      userId,
      action: 'catalog.renamed',
      details: target,
    });
  });
}
