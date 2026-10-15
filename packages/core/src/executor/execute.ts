import { createHash } from 'node:crypto';

import { getAppDb, getPool, queryRun, type QueryOrigin, type QueryPath } from '@bizr/db';
import { currentCorrelationId, getLogger } from '@bizr/platform';

import { ident } from '../sql/ident';
import { tenantNames } from '../tenancy/names';

export interface TenantRef {
  workspaceId: string;
  tenantSchema: string;
}

export interface ExecuteRequest {
  tenant: TenantRef;
  /**
   * SQL produced by our own compilers, or fallback SQL that already passed the validator.
   * Never raw model output. Values must be passed as `params`, never interpolated.
   */
  sql: string;
  params?: unknown[];
  /** `read` (default) runs READ ONLY as the reader role; `write` runs as the writer role. */
  mode?: 'read' | 'write';
  origin: QueryOrigin;
  path: QueryPath;
  /** Read mode only. Default 5,000; one extra row is fetched to detect truncation. */
  rowLimit?: number;
  /** Default 8s. */
  timeoutMs?: number;
}

export interface ExecuteResult {
  rows: Record<string, unknown>[];
  fields: { name: string; dataTypeId: number }[];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
}

export class QueryExecutionError extends Error {
  constructor(
    message: string,
    /** Plain-language message that is safe to show to the user. */
    readonly userMessage: string,
    /** Postgres SQLSTATE, when the database reported one. */
    readonly code: string | undefined,
  ) {
    super(message);
  }
}

export const DEFAULT_ROW_LIMIT = 5_000;
export const DEFAULT_TIMEOUT_MS = 8_000;
const CURSOR = 'bizr_q';

/**
 * The only way to run SQL against tenant data (ARCHITECTURE §6). Each call is one transaction that:
 * 1. pins `search_path` to the tenant's schema and sets statement and idle timeouts,
 * 2. switches to exactly one tenant role with `SET LOCAL ROLE` (the login role has no privileges;
 *    tenant roles cannot call set_config, so the SQL cannot switch role or undo the settings),
 * 3. is READ ONLY in read mode, and reads through a cursor so at most `rowLimit + 1` rows come back.
 * Every execution is recorded in `app.query_run`.
 */
export async function executeTenantQuery(request: ExecuteRequest): Promise<ExecuteResult> {
  const mode = request.mode ?? 'read';
  const names = tenantNames(request.tenant.tenantSchema);
  const rowLimit = Math.max(1, Math.min(request.rowLimit ?? DEFAULT_ROW_LIMIT, 50_000));
  const timeoutMs = Math.max(100, Math.min(request.timeoutMs ?? DEFAULT_TIMEOUT_MS, 60_000));
  const started = performance.now();

  const client = await getPool('tenant').connect();
  let result: ExecuteResult | undefined;
  let failure: unknown;
  try {
    await client.query(mode === 'read' ? 'BEGIN READ ONLY' : 'BEGIN');
    // Settings first, while still the broker role: tenant roles cannot call set_config at all.
    await client.query(
      `SELECT set_config('search_path', $1, true),
              set_config('statement_timeout', $2, true),
              set_config('idle_in_transaction_session_timeout', $3, true)`,
      [ident(names.schema), String(timeoutMs), String(timeoutMs + 2_000)],
    );
    await client.query(
      `SET LOCAL ROLE ${ident(mode === 'read' ? names.readerRole : names.writerRole)}`,
    );

    if (mode === 'read') {
      await client.query(`DECLARE ${CURSOR} NO SCROLL CURSOR FOR ${request.sql}`, request.params);
      const fetched = await client.query<Record<string, unknown>>(
        `FETCH FORWARD ${rowLimit + 1} FROM ${CURSOR}`,
      );
      const truncated = fetched.rows.length > rowLimit;
      const rows = truncated ? fetched.rows.slice(0, rowLimit) : fetched.rows;
      result = {
        rows,
        fields: fetched.fields.map((f) => ({ name: f.name, dataTypeId: f.dataTypeID })),
        rowCount: rows.length,
        truncated,
        durationMs: 0,
      };
    } else {
      const written = await client.query<Record<string, unknown>>(request.sql, request.params);
      result = {
        rows: written.rows,
        fields: written.fields.map((f) => ({ name: f.name, dataTypeId: f.dataTypeID })),
        rowCount: written.rowCount ?? 0,
        truncated: false,
        durationMs: 0,
      };
    }
    await client.query('COMMIT');
  } catch (err) {
    failure = err;
    await client.query('ROLLBACK').catch(() => {});
  } finally {
    // Session state is transaction-local, but never return a broken connection to the pool.
    client.release(
      failure !== undefined && isConnectionError(failure) ? (failure as Error) : undefined,
    );
  }

  const durationMs = Math.round(performance.now() - started);
  await recordRun(request, mode, durationMs, result, failure);

  if (failure !== undefined) throw toExecutionError(failure);
  return { ...result!, durationMs };
}

export async function recordRun(
  request: ExecuteRequest,
  mode: 'read' | 'write',
  durationMs: number,
  result: ExecuteResult | undefined,
  failure: unknown,
): Promise<void> {
  try {
    await getAppDb()
      .insert(queryRun)
      .values({
        workspaceId: request.tenant.workspaceId,
        origin: request.origin,
        path: request.path,
        mode,
        sqlHash: createHash('sha256').update(request.sql).digest('hex'),
        sqlText: request.sql,
        durationMs,
        rowCount: result?.rowCount ?? null,
        truncated: result?.truncated ?? false,
        error: failure === undefined ? null : String((failure as Error).message ?? failure),
        correlationId: currentCorrelationId() ?? null,
      });
  } catch (err) {
    getLogger('executor').error({ err }, 'failed to record query_run');
  }
}

function sqlState(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string'
    ? err.code
    : undefined;
}

export function isConnectionError(err: unknown): boolean {
  const code = sqlState(err);
  return code === undefined || code.startsWith('08');
}

function toExecutionError(err: unknown): QueryExecutionError {
  const code = sqlState(err);
  const message = err instanceof Error ? err.message : String(err);
  let userMessage =
    "We couldn't work that out from your data. Please try asking in a different way.";
  if (code === '57014') {
    userMessage =
      'That took too long. Try a shorter date range, or ask about fewer things at once.';
  } else if (code === '42501') {
    userMessage = "That isn't something we can look up.";
  } else if (code?.startsWith('08') || code === undefined) {
    userMessage = 'We had trouble reaching your data. Please try again in a moment.';
  }
  return new QueryExecutionError(message, userMessage, code);
}
