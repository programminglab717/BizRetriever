import { isDateValue, type CleanValue } from '@bizr/ingest';

import type { CatalogEntity } from '../change-plan/compile';
import { columnsFor } from '../change-plan/names';
import type { FieldDef } from '../change-plan/schema';
import type { TenantWriter } from '../executor/write';
import { ident } from '../sql/ident';
import type { MaterializedRecord, MaterializeResult } from './materialize';

/**
 * Writes materialised records into the tenant's tables (ARCHITECTURE §2, ingest.apply). Record
 * types are inserted so that linked records exist first; links become `<field>_id` foreign keys,
 * and the original text is always kept in `<field>_ref`. All values are parameters.
 */

const MAX_PARAMS = 30_000;

export interface LoadStats {
  entity: string;
  rowsIn: number;
  inserted: number;
}

/** Linked-to record types first. Cycles (none in the retail pack) fall back to catalog order. */
export function loadOrder(catalog: readonly CatalogEntity[], keys: readonly string[]): string[] {
  const wanted = new Set(keys);
  const out: string[] = [];
  const visiting = new Set<string>();
  const visit = (key: string) => {
    if (out.includes(key) || visiting.has(key) || !wanted.has(key)) return;
    visiting.add(key);
    const e = catalog.find((c) => c.key === key);
    for (const f of e?.fields ?? []) if (f.references && f.references !== key) visit(f.references);
    visiting.delete(key);
    out.push(key);
  };
  for (const k of keys) visit(k);
  return out;
}

/** A cleaned value as a Postgres parameter. Decimals go as exact strings, never floats. */
export function toParam(def: FieldDef, v: CleanValue): string | boolean | null {
  if (v === null || v === undefined) return null;
  switch (def.type) {
    case 'text':
      return typeof v === 'string' ? v : isDateValue(v) ? v.date : String(v);
    case 'integer':
      return typeof v === 'number' && Number.isFinite(v) ? Math.round(v).toString() : null;
    case 'decimal':
    case 'money':
      return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(4) : null;
    case 'percent':
      return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(6) : null;
    case 'boolean':
      return typeof v === 'boolean' ? v : null;
    case 'date':
      return isDateValue(v) ? v.date : null;
    case 'datetime': {
      if (!isDateValue(v)) return null;
      const time = v.time ?? '00:00:00';
      if (v.offsetMinutes === undefined) return `${v.date}T${time}`;
      const sign = v.offsetMinutes < 0 ? '-' : '+';
      const abs = Math.abs(v.offsetMinutes);
      const hh = String(Math.floor(abs / 60)).padStart(2, '0');
      const mm = String(abs % 60).padStart(2, '0');
      return `${v.date}T${time}${sign}${hh}:${mm}`;
    }
    case 'reference':
      return null;
  }
}

/** True when this import's records are already in the tenant tables (the step is being re-run). */
export async function alreadyLoaded(
  writer: TenantWriter,
  catalog: readonly CatalogEntity[],
  entities: readonly string[],
  uploadIds: readonly string[],
): Promise<boolean> {
  for (const key of entities) {
    const e = catalog.find((c) => c.key === key);
    if (!e) continue;
    const r = await writer.query(
      `SELECT 1 FROM ${ident(e.tableName)} WHERE _source_upload_id = ANY($1::uuid[]) LIMIT 1`,
      [uploadIds],
    );
    if (r.rows.length > 0) return true;
  }
  return false;
}

export async function loadRecords(
  writer: TenantWriter,
  catalog: readonly CatalogEntity[],
  result: MaterializeResult,
  /** Upload id for each file position (source ids are "f<position>:…"). */
  uploadIds: readonly string[],
): Promise<LoadStats[]> {
  const keys = [...result.entities.keys()].filter((k) => (result.entities.get(k)?.length ?? 0) > 0);
  const ids = new Map<string, (string | null)[]>();
  const stats: LoadStats[] = [];

  for (const key of loadOrder(catalog, keys)) {
    const entity = catalog.find((c) => c.key === key);
    if (!entity) throw new Error(`Record type ${key} has no table yet`);
    const records = result.entities.get(key) ?? [];

    const columns: string[] = [];
    const getters: ((r: MaterializedRecord) => unknown)[] = [];
    for (const def of entity.fields) {
      const cols = columnsFor(def);
      if (cols.fk && cols.ref) {
        const targetIds = () => ids.get(def.references!);
        columns.push(cols.fk, cols.ref);
        getters.push(
          (r) => {
            const i = r.links[def.key];
            return i === null || i === undefined ? null : (targetIds()?.[i] ?? null);
          },
          (r) => r.refs[def.key] ?? null,
        );
      } else {
        columns.push(cols.value!);
        getters.push((r) => toParam(def, r.fields[def.key] ?? null));
      }
    }
    columns.push('_natural_key', '_row_hash', '_source_upload_id', '_source_sheet', '_source_row');
    getters.push(
      (r) => r.naturalKey,
      (r) => r.rowHash,
      (r) => {
        const pos = Number(/^f(\d+):/.exec(r.lineage[0]?.sourceId ?? '')?.[1]);
        return Number.isInteger(pos) ? (uploadIds[pos] ?? null) : null;
      },
      (r) => r.lineage[0]?.sheet ?? null,
      (r) => r.lineage[0]?.row ?? null,
    );

    const perBatch = Math.max(1, Math.floor(MAX_PARAMS / columns.length));
    const inserted: (string | null)[] = [];
    for (let start = 0; start < records.length; start += perBatch) {
      const batch = records.slice(start, start + perBatch);
      const params: unknown[] = [];
      const tuples = batch.map((r) => {
        const placeholders = getters.map((g) => {
          params.push(g(r));
          return `$${params.length}`;
        });
        return `(${placeholders.join(', ')})`;
      });
      // INSERT … VALUES … RETURNING returns rows in VALUES order.
      const res = await writer.query<{ _id: string }>(
        `INSERT INTO ${ident(entity.tableName)} (${columns.map(ident).join(', ')}) VALUES ${tuples.join(', ')} RETURNING _id`,
        params,
      );
      inserted.push(...res.rows.map((row) => String(row._id)));
    }
    ids.set(key, inserted);
    stats.push({ entity: key, rowsIn: records.length, inserted: inserted.length });
  }
  return stats;
}
