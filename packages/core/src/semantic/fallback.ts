import { loadCatalog } from '../change-plan/apply';
import { queryableRelations } from '../change-plan/views';
import { executeTenantQuery, QueryExecutionError, type ExecuteResult } from '../executor/execute';
import { validateFallbackSql } from '../sql-validator/validate';

/**
 * The SQL fallback path (ADR-007): only for questions a query spec can't express. The SQL must pass
 * the validator, then runs READ ONLY as the tenant's reader with a timeout and a row cap.
 */
export type FallbackResult =
  | { ok: true; result: ExecuteResult; sql: string }
  | { ok: false; userMessage: string; reason: string };

export async function runFallbackSql(
  ws: { id: string; tenantSchema: string },
  sql: string,
  options: { rowLimit?: number; timeoutMs?: number } = {},
): Promise<FallbackResult> {
  const catalog = await loadCatalog(ws.id);
  const v = await validateFallbackSql(sql, {
    tenantSchema: ws.tenantSchema,
    relations: queryableRelations(catalog),
  });
  if (!v.ok)
    return {
      ok: false,
      reason: v.reason,
      userMessage: 'I couldn’t work that out safely. Try asking in a different way.',
    };
  try {
    const result = await executeTenantQuery({
      tenant: { workspaceId: ws.id, tenantSchema: ws.tenantSchema },
      sql: v.sql,
      origin: 'ask',
      path: 'sql_fallback',
      rowLimit: options.rowLimit ?? 1_000,
      timeoutMs: options.timeoutMs ?? 8_000,
    });
    return { ok: true, result, sql: v.sql };
  } catch (err) {
    if (err instanceof QueryExecutionError)
      return { ok: false, userMessage: err.userMessage, reason: err.message };
    throw err;
  }
}
