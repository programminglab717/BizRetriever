import { getAppDb, upload, user } from '@bizr/db';
import { getPack } from '@bizr/packs';
import { and, eq, inArray } from 'drizzle-orm';

import { loadCatalog } from '../change-plan/apply';
import type { CatalogEntity } from '../change-plan/compile';
import { columnsFor } from '../change-plan/names';
import type { FieldDef } from '../change-plan/schema';
import { bumpDataVersion } from '../dashboard/service';
import { asText } from '../merge/diff';
import { executeTenantQuery } from '../executor/execute';
import { withTenantWriter, type TenantWriter } from '../executor/write';
import { ident } from '../sql/ident';
import { requireEditor, type MemberWorkspace } from '../workspaces/service';
import {
  EDIT_TABLE,
  ensureEditLog,
  logEdits,
  undoBatch,
  UndoError,
  type LoggedEdit,
} from './edits';
import { parseEditValue, titleFieldOf } from './values';

/**
 * My data (PRODUCT_SPEC §4.2): browse, open, edit, delete and restore records. Reads run as the
 * tenant's reader role; writes as its writer role, logged in the edit log so each can be undone.
 * Every identifier comes from the catalog and is quoted with `ident`; every value is a parameter.
 */

export class RecordsError extends Error {}

export const DELETED_DAYS = 30;
const PAGE_MAX = 200;

export interface FieldMeta {
  key: string;
  label: string;
  type: FieldDef['type'];
  required: boolean;
  allowedValues?: string[] | undefined;
  /** Linked record type, for reference fields. */
  references?: string | undefined;
  /** Display names for coded values ({ online_store: "Website" }). */
  valueLabels?: Record<string, string> | undefined;
}

export interface EntityMeta {
  key: string;
  label: { singular: string; plural: string };
  description: string;
  fields: FieldMeta[];
  titleField: string | undefined;
}

export interface RecordRow {
  id: string;
  title: string;
  /** Field key → value as text (dates `YYYY-MM-DD`, date-times local `YYYY-MM-DDTHH:MM:SS`). */
  values: Record<string, string | null>;
  /** Reference field key → id of the linked record. */
  links: Record<string, string | null>;
  deletedAt: string | null;
}

type ValueLabels = ReadonlyMap<string, Record<string, string>>;

const valueLabelsOf = (member: MemberWorkspace): ValueLabels => {
  try {
    return new Map(
      getPack(member.workspace.packId).metrics.dimensions.map((d) => [d.field, d.value_labels]),
    );
  } catch {
    return new Map();
  }
};

const metaOf = (e: CatalogEntity, labels: ValueLabels = new Map()): EntityMeta => ({
  key: e.key,
  label: e.label,
  description: e.description,
  fields: e.fields.map((f) => {
    const vl = labels.get(`${e.key}.${f.key}`);
    return {
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      allowedValues: f.allowedValues,
      references: f.references,
      ...(vl && Object.keys(vl).length ? { valueLabels: vl } : {}),
    };
  }),
  titleField: titleFieldOf(e.fields),
});

const tenantOf = (m: MemberWorkspace) => ({
  workspaceId: m.workspace.id,
  tenantSchema: m.workspace.tenantSchema,
});

async function read(member: MemberWorkspace, sql: string, params: unknown[], rowLimit = 1_000) {
  return (
    await executeTenantQuery({
      tenant: tenantOf(member),
      sql,
      params,
      origin: 'records',
      path: 'system',
      rowLimit,
    })
  ).rows;
}

async function catalogEntity(member: MemberWorkspace, key: string) {
  const catalog = await loadCatalog(member.workspace.id);
  const e = catalog.find((c) => c.key === key);
  if (!e) throw new RecordsError('We couldn’t find those records.');
  return { catalog, e };
}

/** Parameters that come first in every row query: the time zone, when there are date-times to show. */
const baseParams = (member: MemberWorkspace, e: CatalogEntity): unknown[] =>
  e.fields.some((f) => f.type === 'datetime') ? [member.settings.timezone] : [];

/**
 * SELECT pieces for an entity's rows: the title, every field as text, and the linked records' ids.
 * Date-times are shown in local time: `$1` is the workspace time zone (see `baseParams`).
 */
function selectFor(catalog: readonly CatalogEntity[], e: CatalogEntity) {
  const cols: string[] = [];
  const joins: string[] = [];
  const sortable = new Map<string, string>();
  const searchable: string[] = [];
  const title = titleFieldOf(e.fields);
  e.fields.forEach((f, i) => {
    const out = ident(`f_${f.key}`);
    if (f.type === 'reference') {
      const c = columnsFor(f);
      const target = catalog.find((t) => t.key === f.references);
      const targetTitle = target ? titleFieldOf(target.fields) : undefined;
      const alias = `r${i}`;
      let expr = `b.${ident(c.ref!)}`;
      if (target && targetTitle) {
        joins.push(
          `LEFT JOIN ${ident(target.tableName)} ${alias} ON ${alias}."_id" = b.${ident(c.fk!)}`,
        );
        expr = `COALESCE(${alias}.${ident(targetTitle)}::text, b.${ident(c.ref!)})`;
      }
      cols.push(`${expr} AS ${out}`, `b.${ident(c.fk!)}::text AS ${ident(`l_${f.key}`)}`);
      sortable.set(f.key, expr);
      searchable.push(expr);
      return;
    }
    const col = `b.${ident(f.key)}`;
    const expr =
      f.type === 'datetime'
        ? `to_char(${col} AT TIME ZONE $1, 'YYYY-MM-DD"T"HH24:MI:SS')`
        : f.type === 'date'
          ? `to_char(${col}, 'YYYY-MM-DD')`
          : `${col}::text`;
    cols.push(`${expr} AS ${out}`);
    sortable.set(f.key, col);
    if (f.type === 'text') searchable.push(col);
  });
  const titleExpr = title ? `b.${ident(title)}::text` : 'NULL::text';
  return {
    select: `b."_id"::text AS "_id", b."_deleted_at"::text AS "_deleted_at", ${titleExpr} AS "_title"${cols.length ? `, ${cols.join(', ')}` : ''}`,
    from: `${ident(e.tableName)} b ${joins.join(' ')}`,
    sortable,
    searchable,
  };
}

function toRow(e: CatalogEntity, r: Record<string, unknown>): RecordRow {
  const id = String(r._id);
  const text = (v: unknown) => (v === null || v === undefined ? null : asText(v));
  return {
    id,
    title: text(r._title) ?? `${e.label.singular} #${id}`,
    values: Object.fromEntries(e.fields.map((f) => [f.key, text(r[`f_${f.key}`])])),
    links: Object.fromEntries(
      e.fields.filter((f) => f.type === 'reference').map((f) => [f.key, text(r[`l_${f.key}`])]),
    ),
    deletedAt: text(r._deleted_at),
  };
}

/** "Products 412, Sales 1,280…": the record types with how many there are. */
export async function listRecordTypes(
  member: MemberWorkspace,
): Promise<(EntityMeta & { count: number; deleted: number })[]> {
  const catalog = await loadCatalog(member.workspace.id);
  if (catalog.length === 0) return [];
  const sql = catalog
    .map(
      (e, i) =>
        `SELECT ${i} AS i, count(*) FILTER (WHERE "_deleted_at" IS NULL) AS n, count(*) FILTER (WHERE "_deleted_at" > now() - make_interval(days => ${DELETED_DAYS})) AS d FROM ${ident(e.tableName)}`,
    )
    .join(' UNION ALL ');
  const rows = await read(member, sql, []);
  const counts = new Map(rows.map((r) => [Number(r.i), { n: Number(r.n), d: Number(r.d) }]));
  const labels = valueLabelsOf(member);
  return catalog.map((e, i) => ({
    ...metaOf(e, labels),
    count: counts.get(i)?.n ?? 0,
    deleted: counts.get(i)?.d ?? 0,
  }));
}

export interface BrowseInput {
  entity: string;
  search?: string | undefined;
  sort?: string | undefined;
  dir?: 'asc' | 'desc' | undefined;
  /** Exact matches: allowed-value or yes/no details, or a linked record's id. `null` is blank. */
  filters?: { field: string; value: string | null }[] | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
  /** "Recently deleted" instead of the live records. */
  deleted?: boolean | undefined;
}

export interface BrowseResult {
  entity: EntityMeta;
  rows: RecordRow[];
  total: number;
  offset: number;
  sort: string | undefined;
  dir: 'asc' | 'desc';
}

export async function browseRecords(
  member: MemberWorkspace,
  input: BrowseInput,
): Promise<BrowseResult> {
  const { catalog, e } = await catalogEntity(member, input.entity);
  const s = selectFor(catalog, e);
  const params = baseParams(member, e);
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where = [
    input.deleted
      ? `b."_deleted_at" > now() - make_interval(days => ${DELETED_DAYS})`
      : `b."_deleted_at" IS NULL`,
  ];
  const search = input.search?.trim().slice(0, 100);
  if (search && s.searchable.length) {
    const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const ph = p(pattern);
    where.push(`(${s.searchable.map((x) => `${x} ILIKE ${ph}`).join(' OR ')})`);
  }
  for (const filter of input.filters ?? []) {
    const f = e.fields.find((x) => x.key === filter.field);
    if (!f) throw new RecordsError('That filter isn’t available.');
    const col = f.type === 'reference' ? `b.${ident(columnsFor(f).fk!)}` : `b.${ident(f.key)}`;
    if (filter.value === null) {
      where.push(`${col} IS NULL`);
      continue;
    }
    if (f.type === 'reference') {
      if (!/^\d{1,18}$/.test(filter.value)) throw new RecordsError('That filter isn’t available.');
      where.push(`${col} = ${p(filter.value)}::bigint`);
    } else if (f.type === 'boolean') where.push(`${col} = ${p(filter.value === 'true')}`);
    else if (f.type === 'text') where.push(`${col} = ${p(filter.value)}`);
    else throw new RecordsError('That filter isn’t available.');
  }
  const defaultSort = e.timeField ?? titleFieldOf(e.fields);
  const sort = input.sort && s.sortable.has(input.sort) ? input.sort : defaultSort;
  const dir = input.dir ?? (sort && sort === e.timeField ? 'desc' : 'asc');
  const sql = (dir === 'desc' ? 'DESC' : 'ASC') as string;
  const order = [
    ...(sort && s.sortable.has(sort) ? [`${s.sortable.get(sort)!} ${sql} NULLS LAST`] : []),
    `b."_id" ${sql}`,
  ];
  const limit = Math.max(1, Math.min(input.limit ?? 100, PAGE_MAX));
  const offset = Math.max(0, Math.min(Math.trunc(input.offset ?? 0), 1_000_000));
  // Both queries take the same parameters; the count has no date-times, so it names the time zone here.
  if (params.length && baseParams(member, e).length) where.push(`$1::text IS NOT NULL`);
  const whereSql = where.join(' AND ');
  const [rows, count] = await Promise.all([
    read(
      member,
      `SELECT ${s.select} FROM ${s.from} WHERE ${whereSql} ORDER BY ${order.join(', ')} LIMIT ${limit} OFFSET ${offset}`,
      params,
      limit,
    ),
    read(member, `SELECT count(*) AS n FROM ${s.from} WHERE ${whereSql}`, params),
  ]);
  return {
    entity: metaOf(e, valueLabelsOf(member)),
    rows: rows.map((r) => toRow(e, r)),
    total: Number(count[0]?.n ?? 0),
    offset,
    sort,
    dir,
  };
}

const EXPORT_BATCH = 1_000;

/**
 * Every live record of one type, oldest first, up to `max` (for "Download all my data"). Reads in
 * batches by id, so a big shop doesn't page with ever-larger offsets.
 */
export async function allRecords(
  member: MemberWorkspace,
  entity: string,
  max = 100_000,
): Promise<{ entity: EntityMeta; rows: RecordRow[]; total: number }> {
  const { catalog, e } = await catalogEntity(member, entity);
  const s = selectFor(catalog, e);
  const base = baseParams(member, e);
  const after = `$${base.length + 1}`;
  const rows: RecordRow[] = [];
  let last = '0';
  while (rows.length < max) {
    const batch = await read(
      member,
      `SELECT ${s.select} FROM ${s.from} WHERE b."_deleted_at" IS NULL AND b."_id" > ${after}::bigint ORDER BY b."_id" LIMIT ${EXPORT_BATCH}`,
      [...base, last],
      EXPORT_BATCH,
    );
    rows.push(...batch.map((r) => toRow(e, r)));
    if (batch.length < EXPORT_BATCH) break;
    last = rows.at(-1)!.id;
  }
  const kept = rows.slice(0, max);
  const total =
    rows.length < max
      ? kept.length
      : Number(
          (
            await read(
              member,
              `SELECT count(*) AS n FROM ${ident(e.tableName)} WHERE "_deleted_at" IS NULL`,
              [],
            )
          )[0]?.n ?? kept.length,
        );
  return { entity: metaOf(e, valueLabelsOf(member)), rows: kept, total };
}

/** For linking a record: "Bloom" → matching customers. */
export async function searchRecords(
  member: MemberWorkspace,
  entity: string,
  q: string,
  limit = 10,
): Promise<{ id: string; title: string }[]> {
  const r = await browseRecords(member, {
    entity,
    search: q,
    limit,
    sort: titleFieldOf((await catalogEntity(member, entity)).e.fields),
    dir: 'asc',
  });
  return r.rows.map((x) => ({ id: x.id, title: x.title }));
}

export interface RecordDetail {
  entity: EntityMeta;
  record: RecordRow;
  /** "Where this came from". */
  source: { fileName: string | null; sheet: string | null; row: number | null } | null;
  createdAt: string;
  updatedAt: string;
  /** Records that link to this one (a customer's sales). */
  linked: {
    entity: string;
    label: { singular: string; plural: string };
    field: string;
    count: number;
    examples: { id: string; title: string }[];
  }[];
  history: {
    batchId: string;
    op: 'insert' | 'update' | 'delete' | 'restore';
    origin: 'grid' | 'chat' | 'reupload';
    by: string | null;
    at: string;
    undone: boolean;
    changes: { field: string; label: string; from: string | null; to: string | null }[];
  }[];
}

export async function getRecord(
  member: MemberWorkspace,
  entity: string,
  id: string,
): Promise<RecordDetail> {
  if (!/^\d{1,18}$/.test(id)) throw new RecordsError('We couldn’t find that record.');
  const { catalog, e } = await catalogEntity(member, entity);
  await ensureEditLog(member.workspace.tenantSchema);
  const s = selectFor(catalog, e);
  const params = baseParams(member, e);
  const [row] = await read(
    member,
    `SELECT ${s.select}, b."_source_upload_id"::text AS "_upload", b."_source_sheet" AS "_sheet", b."_source_row" AS "_row",
            b."_created_at"::text AS "_created", b."_updated_at"::text AS "_updated"
     FROM ${s.from} WHERE b."_id" = $${params.length + 1}::bigint`,
    [...params, id],
  );
  if (!row) throw new RecordsError('We couldn’t find that record.');

  let source: RecordDetail['source'] = null;
  if (row._upload || row._sheet) {
    const [u] = row._upload
      ? await getAppDb()
          .select({ fileName: upload.fileName })
          .from(upload)
          .where(
            and(
              eq(upload.id, String(row._upload as string)),
              eq(upload.workspaceId, member.workspace.id),
            ),
          )
      : [];
    source = {
      fileName: u?.fileName ?? null,
      sheet: (row._sheet as string | null) ?? null,
      row: row._row === null || row._row === undefined ? null : Number(row._row),
    };
  }

  const linked: RecordDetail['linked'] = [];
  for (const other of catalog)
    for (const f of other.fields) {
      if (f.type !== 'reference' || f.references !== e.key) continue;
      const fk = ident(columnsFor(f).fk!);
      const otherTitle = titleFieldOf(other.fields);
      const order = other.timeField
        ? `${ident(other.timeField)} DESC NULLS LAST, "_id" DESC`
        : `"_id" DESC`;
      const [n] = await read(
        member,
        `SELECT count(*) AS n FROM ${ident(other.tableName)} WHERE ${fk} = $1::bigint AND "_deleted_at" IS NULL`,
        [id],
      );
      const count = Number(n?.n ?? 0);
      if (count === 0) continue;
      const examples = await read(
        member,
        `SELECT "_id"::text AS id, ${otherTitle ? `${ident(otherTitle)}::text` : 'NULL::text'} AS title FROM ${ident(other.tableName)}
         WHERE ${fk} = $1::bigint AND "_deleted_at" IS NULL ORDER BY ${order} LIMIT 5`,
        [id],
      );
      linked.push({
        entity: other.key,
        label: other.label,
        field: f.key,
        count,
        examples: examples.map((x) => ({
          id: String(x.id as string),
          title: (x.title as string | null) ?? `${other.label.singular} #${String(x.id as string)}`,
        })),
      });
    }

  const edits = await read(
    member,
    `SELECT batch_id::text AS batch_id, op, origin, user_id::text AS user_id, before, after, created_at::text AS at, undone_at IS NOT NULL AS undone
     FROM ${ident(EDIT_TABLE)} WHERE table_name = $1 AND record_id = $2::bigint ORDER BY "_id" DESC LIMIT 50`,
    [e.tableName, id],
  );
  const userIds = [
    ...new Set(edits.map((x) => x.user_id as string | null).filter((x): x is string => !!x)),
  ];
  const names = new Map(
    userIds.length
      ? (
          await getAppDb()
            .select({ id: user.id, name: user.name })
            .from(user)
            .where(inArray(user.id, userIds))
        ).map((u) => [u.id, u.name])
      : [],
  );
  const history: RecordDetail['history'] = edits.map((x) => {
    const before = (x.before ?? {}) as Record<string, unknown>;
    const after = (x.after ?? {}) as Record<string, unknown>;
    const changes = Object.keys(after)
      .map((col) => {
        const f = e.fields.find((ff) => {
          const c = columnsFor(ff);
          return c.value === col || c.ref === col;
        });
        if (!f) return null;
        const v = (o: Record<string, unknown>) =>
          o[col] === null || o[col] === undefined ? null : asText(o[col]);
        return { field: f.key, label: f.label, from: v(before), to: v(after) };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
    return {
      batchId: String(x.batch_id),
      op: x.op as RecordDetail['history'][number]['op'],
      origin: x.origin as RecordDetail['history'][number]['origin'],
      by: x.user_id ? (names.get(asText(x.user_id)) ?? null) : null,
      at: String(x.at),
      undone: Boolean(x.undone),
      changes,
    };
  });

  return {
    entity: metaOf(e, valueLabelsOf(member)),
    record: toRow(e, row),
    source,
    createdAt: String(row._created),
    updatedAt: String(row._updated),
    linked,
    history,
  };
}

// --- Writes -------------------------------------------------------------------------------------

async function write<T>(
  member: MemberWorkspace,
  label: string,
  fn: (w: TenantWriter) => Promise<T>,
): Promise<T> {
  await ensureEditLog(member.workspace.tenantSchema);
  const out = await withTenantWriter(tenantOf(member), label, fn, {
    timezone: member.settings.timezone,
  });
  // Cached dashboard tiles and answers are keyed by the data version.
  await bumpDataVersion(member.workspace.id);
  return out;
}

export interface EditResult {
  /** Undo handle; `null` when nothing changed. */
  batchId: string | null;
  record: RecordRow | null;
}

/** Inline edit of one detail. The value is checked against the field's type first. */
export async function editRecord(input: {
  member: MemberWorkspace;
  userId: string;
  entity: string;
  id: string;
  field: string;
  value: unknown;
  origin?: 'grid' | 'chat';
}): Promise<EditResult> {
  requireEditor(input.member);
  const { member } = input;
  if (!/^\d{1,18}$/.test(input.id)) throw new RecordsError('We couldn’t find that record.');
  const { catalog, e } = await catalogEntity(member, input.entity);
  const f = e.fields.find((x) => x.key === input.field);
  if (!f) throw new RecordsError('That detail can’t be changed here.');
  const parsed = parseEditValue(f, input.value);
  if (!parsed.ok) throw new RecordsError(parsed.error);
  const c = columnsFor(f);
  const cols = f.type === 'reference' ? [c.fk!, c.ref!] : [c.value!];
  const batchId = crypto.randomUUID();

  const changed = await write(member, `records.edit ${e.key}#${input.id}`, async (w) => {
    const { rows } = await w.query(
      `SELECT ${cols.map((x) => `${ident(x)}::text AS ${ident(x)}`).join(', ')}, ${titleSelect(e)} AS "_title"
       FROM ${ident(e.tableName)} WHERE "_id" = $1::bigint AND "_deleted_at" IS NULL FOR UPDATE`,
      [input.id],
    );
    const current = rows[0];
    if (!current) throw new RecordsError('We couldn’t find that record. It may have been deleted.');
    let next: Record<string, unknown>;
    if (f.type === 'reference') {
      if (parsed.value === null) next = { [c.fk!]: null, [c.ref!]: null };
      else {
        const target = catalog.find((t) => t.key === f.references);
        if (!target) throw new RecordsError('That link isn’t available.');
        const { rows: found } = await w.query(
          `SELECT "_id"::text AS id, ${titleSelect(target)} AS title FROM ${ident(target.tableName)} WHERE "_id" = $1::bigint AND "_deleted_at" IS NULL`,
          [parsed.value],
        );
        if (!found[0]) throw new RecordsError(`Choose a ${f.label.toLowerCase()} from the list.`);
        next = {
          [c.fk!]: found[0].id,
          [c.ref!]: found[0].title ?? `${target.label.singular} #${String(found[0].id)}`,
        };
      }
    } else next = { [c.value!]: parsed.value === null ? null : String(parsed.value) };

    // Compare as the database would store it.
    const { rows: cmp } = await w.query(
      `SELECT ${cols.map((x, i) => `($${i + 2}::${sqlType(f, x)} IS NOT DISTINCT FROM ${ident(x)}) AS ${ident(`same_${i}`)}`).join(', ')}
       FROM ${ident(e.tableName)} WHERE "_id" = $1::bigint`,
      [input.id, ...cols.map((x) => next[x])],
    );
    if (cols.every((_, i) => cmp[0]?.[`same_${i}`] === true)) return false;

    const sets = cols.map((x, i) => `${ident(x)} = $${i + 2}`);
    await w.query(
      `UPDATE ${ident(e.tableName)} SET ${sets.join(', ')}, "_updated_at" = now() WHERE "_id" = $1::bigint`,
      [input.id, ...cols.map((x) => next[x])],
    );
    const before = Object.fromEntries(cols.map((x) => [x, current[x] ?? null]));
    await logEdits(
      w,
      {
        id: batchId,
        origin: input.origin ?? 'grid',
        userId: input.userId,
        summary: `Changed ${f.label.toLowerCase()} of ${String((current._title as string | null) ?? `${e.label.singular} #${input.id}`)}`,
      },
      [
        {
          entity: e.key,
          tableName: e.tableName,
          recordId: input.id,
          op: 'update',
          before,
          after: next,
        },
      ],
    );
    return true;
  });
  if (!changed) return { batchId: null, record: null };
  const detail = await browseOne(member, catalog, e, input.id);
  return { batchId, record: detail };
}

const titleSelect = (e: CatalogEntity) => {
  const t = titleFieldOf(e.fields);
  return t ? `${ident(t)}::text` : 'NULL::text';
};

/** Postgres type of a column, for comparing a parameter with what's stored. */
function sqlType(f: FieldDef, col: string): string {
  if (f.type === 'reference') return col.endsWith('_id') ? 'bigint' : 'text';
  return (
    {
      text: 'text',
      integer: 'bigint',
      decimal: 'numeric',
      money: 'numeric',
      percent: 'numeric',
      date: 'date',
      datetime: 'timestamptz',
      boolean: 'boolean',
    } as const
  )[f.type];
}

async function browseOne(
  member: MemberWorkspace,
  catalog: readonly CatalogEntity[],
  e: CatalogEntity,
  id: string,
) {
  const s = selectFor(catalog, e);
  const params = baseParams(member, e);
  const [row] = await read(
    member,
    `SELECT ${s.select} FROM ${s.from} WHERE b."_id" = $${params.length + 1}::bigint`,
    [...params, id],
  );
  return row ? toRow(e, row) : null;
}

/** Soft delete (restorable for 30 days from "Recently deleted"). Nothing is ever removed. */
export async function deleteRecords(input: {
  member: MemberWorkspace;
  userId: string;
  entity: string;
  ids: string[];
  origin?: 'grid' | 'chat';
}): Promise<{ batchId: string | null; count: number }> {
  requireEditor(input.member);
  return setDeleted(input, true);
}

export async function restoreRecords(input: {
  member: MemberWorkspace;
  userId: string;
  entity: string;
  ids: string[];
}): Promise<{ batchId: string | null; count: number }> {
  requireEditor(input.member);
  return setDeleted(input, false);
}

async function setDeleted(
  input: {
    member: MemberWorkspace;
    userId: string;
    entity: string;
    ids: string[];
    origin?: 'grid' | 'chat';
  },
  deleted: boolean,
): Promise<{ batchId: string | null; count: number }> {
  const ids = [...new Set(input.ids)];
  if (ids.length === 0 || ids.length > 500 || ids.some((x) => !/^\d{1,18}$/.test(x)))
    throw new RecordsError('Choose up to 500 records.');
  const { e } = await catalogEntity(input.member, input.entity);
  const batchId = crypto.randomUUID();
  const done = await write(
    input.member,
    `records.${deleted ? 'delete' : 'restore'} ${e.key}`,
    async (w) => {
      const { rows } = await w.query<{ id: string; title: string | null }>(
        `UPDATE ${ident(e.tableName)} SET "_deleted_at" = ${deleted ? 'now()' : 'NULL'}, "_updated_at" = now()
       WHERE "_id" = ANY($1::bigint[]) AND "_deleted_at" IS ${deleted ? 'NULL' : 'NOT NULL'}
       RETURNING "_id"::text AS id, ${titleSelect(e)} AS title`,
        [ids],
      );
      if (rows.length === 0) return 0;
      const what =
        rows.length === 1
          ? (rows[0]!.title ?? `${e.label.singular} #${rows[0]!.id}`)
          : `${rows.length} ${e.label.plural.toLowerCase()}`;
      const edits: LoggedEdit[] = rows.map((r) => ({
        entity: e.key,
        tableName: e.tableName,
        recordId: r.id,
        op: deleted ? 'delete' : 'restore',
      }));
      await logEdits(
        w,
        {
          id: batchId,
          origin: input.origin ?? 'grid',
          userId: input.userId,
          summary: `${deleted ? 'Deleted' : 'Restored'} ${what}`,
        },
        edits,
      );
      return rows.length;
    },
  );
  return { batchId: done ? batchId : null, count: done };
}

/** The Undo in the toast after an edit, delete or restore. Updates from files are undone from the import. */
export async function undoRecordEdit(
  member: MemberWorkspace,
  batchId: string,
): Promise<{ edits: number }> {
  requireEditor(member);
  if (!/^[0-9a-f-]{36}$/.test(batchId)) throw new RecordsError('There’s nothing to undo.');
  try {
    return await write(member, `records.undo ${batchId}`, async (w) => {
      const { rows } = await w.query<{ origin: string }>(
        `SELECT origin FROM ${ident(EDIT_TABLE)} WHERE batch_id = $1 LIMIT 1`,
        [batchId],
      );
      if (!rows[0]) throw new RecordsError('There’s nothing to undo.');
      if (rows[0].origin === 'reupload')
        throw new RecordsError('Undo updates from files from the import’s page.');
      return undoBatch(w, batchId);
    });
  } catch (err) {
    if (err instanceof UndoError) throw new RecordsError(err.message);
    throw err;
  }
}
