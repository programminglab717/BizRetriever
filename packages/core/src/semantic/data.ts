import type { CatalogEntity } from '../change-plan/compile';
import { columnsFor } from '../change-plan/names';
import { executeTenantQuery, type TenantRef } from '../executor/execute';
import { ident } from '../sql/ident';

/**
 * Which details hold data (`entity.field`), for metric availability. A column that exists but is
 * blank everywhere (a stock list without costs) doesn't count. One counting query per record type,
 * run as the tenant's reader.
 */
export async function fieldsWithData(
  tenant: TenantRef,
  catalog: readonly CatalogEntity[],
): Promise<{ present: Set<string>; counts: Map<string, number> }> {
  const present = new Set<string>();
  const counts = new Map<string, number>();
  for (const e of catalog) {
    const cols = e.fields.map((f) => {
      const c = columnsFor(f);
      return { ref: `${e.key}.${f.key}`, col: c.value ?? c.ref! };
    });
    const select = [
      'count(*) AS "n"',
      ...cols.map((c, i) => `count(${ident(c.col)}) AS ${ident(`c${i}`)}`),
    ].join(', ');
    const r = await executeTenantQuery({
      tenant,
      sql: `SELECT ${select} FROM ${ident(e.tableName)} WHERE "_deleted_at" IS NULL`,
      origin: 'system',
      path: 'system',
    });
    const row = r.rows[0] ?? {};
    counts.set(e.key, Number(row.n ?? 0));
    cols.forEach((c, i) => {
      if (Number(row[`c${i}`] ?? 0) > 0) present.add(c.ref);
    });
  }
  return { present, counts };
}

/**
 * The most common values of the pack's text breakdowns (channels, categories, product names…),
 * for recognising them in questions. Values come from the owner's data: treat them as untrusted.
 */
export async function topValues(
  tenant: TenantRef,
  catalog: readonly CatalogEntity[],
  dimensionFields: readonly string[],
  limit = 200,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const ref of dimensionFields) {
    const [entityKey, fieldKey] = ref.split('.') as [string, string];
    const e = catalog.find((x) => x.key === entityKey);
    const f = e?.fields.find((x) => x.key === fieldKey);
    if (!e || !f || f.type !== 'text') continue;
    const col = ident(f.key);
    const r = await executeTenantQuery({
      tenant,
      sql: `SELECT ${col} AS "v" FROM ${ident(e.tableName)} WHERE "_deleted_at" IS NULL AND ${col} IS NOT NULL GROUP BY ${col} ORDER BY count(*) DESC, ${col} LIMIT ${Math.trunc(limit)}`,
      origin: 'system',
      path: 'system',
    });
    out.set(
      ref,
      r.rows.map((row) => String(row.v)).filter((v) => v.length <= 120),
    );
  }
  return out;
}
