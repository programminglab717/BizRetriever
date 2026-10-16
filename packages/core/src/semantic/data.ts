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
