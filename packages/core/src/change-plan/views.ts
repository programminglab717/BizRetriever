import { qualified, ident, isSafeIdentifier } from '../sql/ident';
import type { CatalogEntity } from './compile';
import { columnsFor, SYSTEM_COLUMNS } from './names';

/**
 * System views (ARCHITECTURE §5): for each record type with links, `v_<table>_enriched` shows its
 * own columns plus those of the records it links to, prefixed `<link>__`. They keep fallback SQL
 * (M4) short. They're owned by the system and rebuilt in the same transaction as every structural
 * change, so they always match the tables.
 */

export function enrichedViewName(tableName: string): string | undefined {
  const name = `v_${tableName}_enriched`;
  return isSafeIdentifier(name) ? name : undefined;
}

const systemNames = SYSTEM_COLUMNS.map((c) => c.split(' ')[0]!);

function ownColumns(e: CatalogEntity): string[] {
  return [
    ...systemNames,
    ...e.fields.flatMap((f) => {
      const c = columnsFor(f);
      return [c.value, c.fk, c.ref].filter((x): x is string => Boolean(x));
    }),
  ];
}

/** DROP statements for the views of `catalog` (run before a structural change). */
export function dropViewStatements(schema: string, catalog: readonly CatalogEntity[]): string[] {
  return catalog.flatMap((e) => {
    const name = enrichedViewName(e.tableName);
    return name ? [`DROP VIEW IF EXISTS ${qualified(schema, name)}`] : [];
  });
}

/** CREATE statements for the views of `catalog` (run after a structural change). */
export function createViewStatements(schema: string, catalog: readonly CatalogEntity[]): string[] {
  const byKey = new Map(catalog.map((e) => [e.key, e]));
  const out: string[] = [];
  for (const e of catalog) {
    const links = e.fields.filter(
      (f) => f.type === 'reference' && f.references && byKey.has(f.references),
    );
    const name = enrichedViewName(e.tableName);
    if (links.length === 0 || !name) continue;
    const select = ownColumns(e).map((c) => `b.${ident(c)}`);
    const joins: string[] = [];
    links.forEach((f, i) => {
      const target = byKey.get(f.references!)!;
      const alias = `l${i}`;
      for (const c of ownColumns(target)) {
        if (c.startsWith('_') && c !== '_id') continue;
        const outName = `${f.key}__${c}`;
        if (isSafeIdentifier(outName)) select.push(`${alias}.${ident(c)} AS ${ident(outName)}`);
      }
      joins.push(
        `LEFT JOIN ${qualified(schema, target.tableName)} ${alias} ON ${alias}."_id" = b.${ident(columnsFor(f).fk!)} AND ${alias}."_deleted_at" IS NULL`,
      );
    });
    out.push(
      `CREATE VIEW ${qualified(schema, name)} AS SELECT ${select.join(', ')} FROM ${qualified(schema, e.tableName)} b ${joins.join(' ')} WHERE b."_deleted_at" IS NULL`,
    );
  }
  return out;
}

/** Internal columns never offered to fallback SQL (lineage, hashes, soft-delete marker). */
export function isInternalColumn(name: string): boolean {
  return (
    name === '_row_hash' ||
    name === '_deleted_at' ||
    name === '_natural_key' ||
    name.startsWith('_source_')
  );
}

/**
 * Every relation fallback SQL may read, with the columns it may see: the business tables and their
 * enriched views. (`_deleted_at` filtering is applied by the validator's shadow copies.)
 */
export function queryableRelations(
  catalog: readonly CatalogEntity[],
): Map<string, { kind: 'table' | 'view'; columns: string[] }> {
  const byKey = new Map(catalog.map((e) => [e.key, e]));
  const out = new Map<string, { kind: 'table' | 'view'; columns: string[] }>();
  for (const e of catalog) {
    const own = ownColumns(e).filter((c) => !isInternalColumn(c));
    out.set(e.tableName, { kind: 'table', columns: own });
    const links = e.fields.filter(
      (f) => f.type === 'reference' && f.references && byKey.has(f.references),
    );
    const name = enrichedViewName(e.tableName);
    if (links.length === 0 || !name) continue;
    const cols = [...own];
    for (const f of links) {
      for (const c of ownColumns(byKey.get(f.references!)!)) {
        if (c.startsWith('_') && c !== '_id') continue;
        const outName = `${f.key}__${c}`;
        if (isSafeIdentifier(outName)) cols.push(outName);
      }
    }
    out.set(name, { kind: 'view', columns: cols });
  }
  return out;
}
