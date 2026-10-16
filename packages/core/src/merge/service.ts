import { dataSource, getAppDb } from '@bizr/db';
import { normalizeLoose } from '@bizr/ingest';
import { and, eq } from 'drizzle-orm';

import type { CatalogEntity } from '../change-plan/compile';
import { columnsFor } from '../change-plan/names';
import type { TenantWriter } from '../executor/write';
import type { ProfiledSource } from '../ingestion/heuristic';
import { loadOrder, toParam } from '../ingestion/load';
import type { MaterializedRecord, MaterializeResult } from '../ingestion/materialize';
import type { ModelProposal, SourceMapping } from '../ingestion/proposal';
import { logEdits, type LoggedEdit } from '../records/edits';
import { ident } from '../sql/ident';
import {
  asText,
  diffRecords,
  hasOffset,
  mergeWrites,
  type ExistingRecord,
  type IncomingRecord,
  type MergeDiff,
  type MergeField,
  type Resolutions,
} from './diff';

/**
 * Re-upload (ARCHITECTURE §9, ADR-043): files the business sends again are recognised by their
 * headers, reuse the mapping the owner approved, and are merged into the records already there:
 * new records added, changed fields updated, nothing deleted, conflicts settled by the owner, and
 * every write logged so the whole update can be undone.
 */

// --- Recognising files --------------------------------------------------------------------------

/** A sheet's identity: its header names, normalised, in order. */
export function sourceSignature(source: Pick<ProfiledSource, 'profile'>): string {
  return source.profile.columns.map((c) => normalizeLoose(c.header)).join('|');
}

export interface SourceMatch {
  sourceId: string;
  dataSourceId: string;
  label: string;
}

/**
 * Swaps in the approved mapping for every sheet we've seen before (same headers, same sheet name).
 * Sheets we haven't seen keep the fresh proposal.
 */
export async function reuseKnownMappings(
  workspaceId: string,
  sources: readonly ProfiledSource[],
  proposal: ModelProposal,
): Promise<{ proposal: ModelProposal; matches: SourceMatch[] }> {
  const known = await getAppDb()
    .select()
    .from(dataSource)
    .where(eq(dataSource.workspaceId, workspaceId));
  const matches: SourceMatch[] = [];
  const sourcesOut = proposal.sources.map((m) => {
    const src = sources.find((s) => s.sourceId === m.sourceId);
    if (!src) return m;
    const sig = sourceSignature(src);
    const ds = known.find((k) => k.signature === sig && k.sheetName === src.sheetName);
    if (!ds) return m;
    matches.push({ sourceId: m.sourceId, dataSourceId: ds.id, label: ds.label });
    return { ...(ds.mapping as SourceMapping), sourceId: m.sourceId };
  });
  return { proposal: { ...proposal, sources: sourcesOut }, matches };
}

/** Remembers the approved mapping of every mapped sheet, and which uploads fed it. */
export async function rememberSources(
  workspaceId: string,
  runId: string,
  proposal: ModelProposal,
  sources: readonly ProfiledSource[],
  uploadIdFor: (sourceId: string) => string,
): Promise<void> {
  const db = getAppDb();
  for (const m of proposal.sources) {
    if (m.decision !== 'map') continue;
    const src = sources.find((s) => s.sourceId === m.sourceId);
    if (!src) continue;
    const signature = sourceSignature(src);
    const uploadId = uploadIdFor(m.sourceId);
    const [existing] = await db
      .select()
      .from(dataSource)
      .where(
        and(
          eq(dataSource.workspaceId, workspaceId),
          eq(dataSource.signature, signature),
          eq(dataSource.sheetName, src.sheetName),
        ),
      );
    if (existing) {
      const ids = new Set([...existing.uploadIds, uploadId]);
      await db
        .update(dataSource)
        .set({
          mapping: m,
          uploadIds: [...ids],
          lastRunId: runId,
          fileName: src.fileName,
          updatedAt: new Date(),
        })
        .where(eq(dataSource.id, existing.id));
    } else
      await db.insert(dataSource).values({
        workspaceId,
        label: `${src.fileName} · ${src.sheetName}`.slice(0, 200),
        fileName: src.fileName,
        sheetName: src.sheetName,
        signature,
        mapping: m,
        uploadIds: [uploadId],
        lastRunId: runId,
      });
  }
}

/** Uploads that fed the sources these sheets match (the scope of "missing"). */
export async function uploadsOfMatchedSources(
  workspaceId: string,
  matches: readonly SourceMatch[],
): Promise<string[]> {
  if (matches.length === 0) return [];
  const rows = await getAppDb()
    .select()
    .from(dataSource)
    .where(eq(dataSource.workspaceId, workspaceId));
  const wanted = new Set(matches.map((m) => m.dataSourceId));
  return [...new Set(rows.filter((r) => wanted.has(r.id)).flatMap((r) => r.uploadIds))];
}

// --- Reading what's there -----------------------------------------------------------------------

const mergeFields = (e: CatalogEntity): MergeField[] =>
  e.fields.map((f) => ({ key: f.key, type: f.type }));

/** Field key for a column ("product_id" / "product_ref" → "product"). */
function fieldOfColumn(e: CatalogEntity, col: string): string | undefined {
  return e.fields.find((f) => {
    const c = columnsFor(f);
    return c.value === col || c.fk === col || c.ref === col;
  })?.key;
}

async function existingRecords(
  writer: TenantWriter,
  e: CatalogEntity,
  scopeUploads: ReadonlySet<string>,
): Promise<ExistingRecord[]> {
  const cols = e.fields.map((f) => columnsFor(f).value ?? columnsFor(f).ref!);
  const { rows } = await writer.query(
    `SELECT _id, _natural_key, _row_hash, _source_upload_id, ${cols.map(ident).join(', ')} FROM ${ident(e.tableName)} WHERE _deleted_at IS NULL`,
  );
  // Fields edited in the app since the record was last updated by an import.
  const edits = await writer.query<{ record_id: string; col: string }>(
    `SELECT e.record_id, jsonb_object_keys(e.after) AS col FROM _record_edit e
     WHERE e.table_name = $1 AND e.op = 'update' AND e.origin IN ('grid', 'chat') AND e.undone_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM _record_edit r WHERE r.table_name = e.table_name AND r.record_id = e.record_id
                       AND r.origin = 'reupload' AND r.undone_at IS NULL AND r._id > e._id)`,
    [e.tableName],
  );
  const edited = new Map<string, Set<string>>();
  for (const r of edits.rows) {
    const key = fieldOfColumn(e, r.col);
    if (!key) continue;
    const set = edited.get(String(r.record_id)) ?? new Set<string>();
    set.add(key);
    edited.set(String(r.record_id), set);
  }
  return rows.map((r) => ({
    id: String(r._id as string | number),
    naturalKey: (r._natural_key as string | null) ?? null,
    rowHash: (r._row_hash as string | null) ?? null,
    values: Object.fromEntries(e.fields.map((f, i) => [f.key, r[cols[i]!]])),
    editedFields: edited.get(String(r._id as string | number)) ?? new Set(),
    inScope: scopeUploads.has(String((r._source_upload_id as string | null) ?? '')),
  }));
}

function incomingFor(e: CatalogEntity, records: readonly MaterializedRecord[]): IncomingRecord[] {
  return records.map((r) => ({
    naturalKey: r.naturalKey,
    rowHash: r.rowHash,
    values: Object.fromEntries(
      e.fields.map((f) => [
        f.key,
        f.type === 'reference' ? (r.refs[f.key] ?? null) : toParam(f, r.fields[f.key] ?? null),
      ]),
    ),
  }));
}

/**
 * Date-times without an offset mean the workspace's local time. Postgres reads them exactly as the
 * loader did (the writer's session time zone), so the comparison is instant to instant.
 */
async function resolveLocalTimes(
  writer: TenantWriter,
  e: CatalogEntity,
  incoming: IncomingRecord[],
): Promise<void> {
  const keys = e.fields.filter((f) => f.type === 'datetime').map((f) => f.key);
  const local = new Set<string>();
  for (const r of incoming)
    for (const k of keys) {
      const v = r.values[k];
      if (typeof v === 'string' && !hasOffset(v)) local.add(v);
    }
  if (local.size === 0) return;
  const { rows } = await writer.query<{ x: string; t: Date }>(
    'SELECT x, x::timestamptz AS t FROM unnest($1::text[]) AS x',
    [[...local]],
  );
  const instant = new Map(rows.map((r) => [r.x, r.t]));
  for (const r of incoming)
    for (const k of keys) {
      const v = r.values[k];
      if (typeof v === 'string' && instant.has(v)) r.values[k] = instant.get(v);
    }
}

// --- Preview ------------------------------------------------------------------------------------

export interface EntityPreview {
  entity: string;
  label: { singular: string; plural: string };
  new: number;
  changed: number;
  unchanged: number;
  missing: number;
  /** "Order #1043: status completed → cancelled" (first few). */
  changeExamples: string[];
  missingExamples: string[];
  conflicts: {
    key: string;
    record: string;
    field: string;
    fieldLabel: string;
    mine: string | null;
    theirs: string | null;
  }[];
  duplicates: number;
  unkeyedNew: number;
}

export interface MergePreview {
  entities: EntityPreview[];
  matches: SourceMatch[];
}

function describe(e: CatalogEntity, key: string | null, values?: Record<string, unknown>): string {
  const name = values?.name ?? values?.order_number ?? values?.sku;
  return `${e.label.singular} ${String((name as string | number | null | undefined) ?? key ?? '').slice(0, 60)}`.trim();
}

/** Diffs a materialised re-upload against the tenant's records, entity by entity. */
export async function diffUpload(
  writer: TenantWriter,
  catalog: readonly CatalogEntity[],
  result: MaterializeResult,
  scopeUploads: ReadonlySet<string>,
): Promise<Map<string, { entity: CatalogEntity; diff: MergeDiff; existing: ExistingRecord[] }>> {
  const keys = [...result.entities.keys()].filter((k) => (result.entities.get(k)?.length ?? 0) > 0);
  const out = new Map<
    string,
    { entity: CatalogEntity; diff: MergeDiff; existing: ExistingRecord[] }
  >();
  for (const key of loadOrder(catalog, keys)) {
    const e = catalog.find((c) => c.key === key);
    if (!e) continue;
    const existing = await existingRecords(writer, e, scopeUploads);
    const incoming = incomingFor(e, result.entities.get(key) ?? []);
    await resolveLocalTimes(writer, e, incoming);
    out.set(key, { entity: e, existing, diff: diffRecords(mergeFields(e), existing, incoming) });
  }
  return out;
}

export function previewOf(
  diffs: Awaited<ReturnType<typeof diffUpload>>,
  matches: SourceMatch[],
): MergePreview {
  const entities = [...diffs.values()].map(({ entity: e, diff, existing }): EntityPreview => {
    const byId = new Map(existing.map((x) => [x.id, x]));
    const label = (f: string) => e.fields.find((x) => x.key === f)?.label ?? f;
    return {
      entity: e.key,
      label: e.label,
      new: diff.new.length,
      changed: diff.changed.length,
      unchanged: diff.unchanged,
      missing: diff.missing.length,
      changeExamples: diff.changed.slice(0, 5).map((c) => {
        const f = c.fields[0]!;
        return `${describe(e, c.naturalKey, byId.get(c.id)?.values)}: ${label(f.field).toLowerCase()} ${f.from ?? 'blank'} → ${f.to ?? 'blank'}`;
      }),
      missingExamples: diff.missing.slice(0, 5).map((m) => describe(e, m.naturalKey, m.values)),
      conflicts: diff.conflicts.slice(0, 200).map((c) => ({
        key: `${c.id}:${c.field}`,
        record: describe(e, c.naturalKey, byId.get(c.id)?.values),
        field: c.field,
        fieldLabel: label(c.field),
        mine: c.mine,
        theirs: c.theirs,
      })),
      duplicates: diff.duplicates.length,
      unkeyedNew: diff.new.filter((n) => n.unkeyed).length,
    };
  });
  return { entities, matches };
}

// --- Apply --------------------------------------------------------------------------------------

export interface MergeStats {
  entity: string;
  inserted: number;
  updated: number;
  unchanged: number;
  missing: number;
}

/**
 * Applies a re-upload in the writer's transaction: inserts and updates only, links resolved against
 * the new records and the ones already there, every write logged under `batchId` for undo.
 */
export async function applyUpload(
  writer: TenantWriter,
  catalog: readonly CatalogEntity[],
  result: MaterializeResult,
  scopeUploads: ReadonlySet<string>,
  options: {
    batchId: string;
    userId: string | null;
    resolutions: Resolutions;
    uploadIdFor: (r: MaterializedRecord) => string | null;
  },
): Promise<MergeStats[]> {
  const diffs = await diffUpload(writer, catalog, result, scopeUploads);
  /** entity → incoming position → tenant id */
  const ids = new Map<string, Map<number, string>>();
  const stats: MergeStats[] = [];
  const lookups = new Map<string, Map<string, string>>();

  /** An existing record of `target` whose key or matching field equals the text. */
  const lookupExisting = async (
    target: CatalogEntity,
    text: string,
    matchOn: readonly string[],
  ) => {
    const cacheKey = `${target.key}:${matchOn.join(',')}`;
    let map = lookups.get(cacheKey);
    if (!map) {
      map = new Map();
      const cols = matchOn.filter((f) =>
        target.fields.some((x) => x.key === f && x.type !== 'reference'),
      );
      const { rows } = await writer.query(
        `SELECT _id, _natural_key${cols.map((c) => `, ${ident(c)}`).join('')} FROM ${ident(target.tableName)} WHERE _deleted_at IS NULL`,
      );
      for (const r of rows) {
        const id = String(r._id);
        if (r._natural_key) map.set(normalizeLoose(asText(r._natural_key)), id);
        for (const c of cols)
          if (r[c] !== null && r[c] !== undefined) map.set(normalizeLoose(asText(r[c])), id);
      }
      lookups.set(cacheKey, map);
    }
    return map.get(normalizeLoose(text));
  };

  for (const [key, { entity: e, diff }] of diffs) {
    const records = result.entities.get(key) ?? [];
    const writes = mergeWrites(diff, options.resolutions);
    const local = new Map<number, string>(diff.matches);
    const edits: LoggedEdit[] = [];

    const linkFor = async (
      r: MaterializedRecord,
      f: CatalogEntity['fields'][number],
    ): Promise<string | null> => {
      const i = r.links[f.key];
      const target = catalog.find((c) => c.key === f.references);
      if (i !== null && i !== undefined) return ids.get(f.references!)?.get(i) ?? null;
      const ref = r.refs[f.key];
      if (!ref || !target) return null;
      const matchOn =
        r.refMatchOn[f.key] ?? target.naturalKeys.filter((k) => k.length === 1).map((k) => k[0]!);
      for (const candidate of r.refAlternatives[f.key]?.length
        ? r.refAlternatives[f.key]!
        : [ref]) {
        const found = await lookupExisting(target, candidate, matchOn);
        if (found) return found;
      }
      return null;
    };

    // Inserts.
    for (const ins of writes.inserts) {
      const r = records[ins.index]!;
      const cols: string[] = [];
      const params: unknown[] = [];
      for (const f of e.fields) {
        const c = columnsFor(f);
        if (c.fk && c.ref) {
          cols.push(c.fk, c.ref);
          params.push(await linkFor(r, f), r.refs[f.key] ?? null);
        } else {
          cols.push(c.value!);
          params.push(toParam(f, r.fields[f.key] ?? null));
        }
      }
      cols.push('_natural_key', '_row_hash', '_source_upload_id', '_source_sheet', '_source_row');
      params.push(
        r.naturalKey,
        r.rowHash,
        options.uploadIdFor(r),
        r.lineage[0]?.sheet ?? null,
        r.lineage[0]?.row ?? null,
      );
      const res = await writer.query<{ _id: string }>(
        `INSERT INTO ${ident(e.tableName)} (${cols.map(ident).join(', ')}) VALUES (${params.map((_, n) => `$${n + 1}`).join(', ')}) RETURNING _id`,
        params,
      );
      const id = String(res.rows[0]!._id);
      local.set(ins.index, id);
      edits.push({ entity: e.key, tableName: e.tableName, recordId: id, op: 'insert' });
    }
    ids.set(key, local);

    // Updates: only the fields that changed (or that the owner chose to take from the file).
    const indexOf = new Map([...diff.matches].map(([index, id]) => [id, index]));
    for (const u of writes.updates) {
      const sets: string[] = [];
      const params: unknown[] = [u.id];
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const current = diffs.get(key)!.existing.find((x) => x.id === u.id);
      for (const [fieldKey, value] of Object.entries(u.set)) {
        const f = e.fields.find((x) => x.key === fieldKey)!;
        const c = columnsFor(f);
        if (c.fk && c.ref) {
          const r = records[indexOf.get(u.id)!]!;
          const link = await linkFor(r, f);
          params.push(value, link);
          sets.push(
            `${ident(c.ref)} = $${params.length - 1}`,
            `${ident(c.fk)} = $${params.length}`,
          );
          before[c.ref] = current?.values[fieldKey] ?? null;
          after[c.ref] = value;
          after[c.fk] = link;
        } else {
          params.push(value);
          sets.push(`${ident(c.value!)} = $${params.length}`);
          before[c.value!] = current?.values[fieldKey] ?? null;
          after[c.value!] = value;
        }
      }
      if (sets.length === 0) continue;
      // The fk's old value, for an exact undo.
      for (const f of e.fields)
        if (f.type === 'reference' && columnsFor(f).fk! in after) {
          const { rows } = await writer.query(
            `SELECT ${ident(columnsFor(f).fk!)} AS v FROM ${ident(e.tableName)} WHERE _id = $1`,
            [u.id],
          );
          before[columnsFor(f).fk!] = rows[0]?.v ?? null;
        }
      await writer.query(
        `UPDATE ${ident(e.tableName)} SET ${sets.join(', ')}, _updated_at = now() WHERE _id = $1`,
        params,
      );
      edits.push({
        entity: e.key,
        tableName: e.tableName,
        recordId: u.id,
        op: 'update',
        before,
        after,
      });
    }

    await logEdits(
      writer,
      {
        id: options.batchId,
        origin: 'reupload',
        userId: options.userId,
        summary: 'Updated from a new file',
      },
      edits,
    );
    stats.push({
      entity: key,
      inserted: writes.inserts.length,
      updated: writes.updates.length,
      unchanged: diff.unchanged,
      missing: diff.missing.length,
    });
  }
  return stats;
}
