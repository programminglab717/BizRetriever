import { getPool } from '@bizr/db';

import { ident } from '../sql/ident';
import { tenantNames } from '../tenancy/names';
import { isConnectionError, recordRun, type TenantRef } from './execute';

/** The only thing a bulk writer can do: run parameterised statements built by our own code. */
export interface TenantWriter {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number }>;
}

/**
 * Runs several writes in ONE transaction as the tenant's writer role (bulk loads from ingestion).
 * Same isolation as `executeTenantQuery`: settings first, then `SET LOCAL ROLE`, `search_path` pinned
 * to the tenant schema. The whole call is recorded as one `query_run` with `label` as its text.
 */
export async function withTenantWriter<T>(
  tenant: TenantRef,
  label: string,
  fn: (writer: TenantWriter) => Promise<T>,
  options: { timeoutMs?: number; timezone?: string } = {},
): Promise<T> {
  const names = tenantNames(tenant.tenantSchema);
  const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? 120_000, 600_000));
  const started = performance.now();
  const client = await getPool('tenant').connect();
  let rowCount = 0;
  let failure: unknown;
  let value: T | undefined;
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('search_path', $1, true),
              set_config('statement_timeout', $2, true),
              set_config('idle_in_transaction_session_timeout', $3, true),
              set_config('timezone', $4, true)`,
      [
        ident(names.schema),
        String(timeoutMs),
        String(timeoutMs + 5_000),
        options.timezone ?? 'UTC',
      ],
    );
    await client.query(`SET LOCAL ROLE ${ident(names.writerRole)}`);
    value = await fn({
      async query<R extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        const r = await client.query<R>(sql, params);
        rowCount += r.rowCount ?? 0;
        return { rows: r.rows, rowCount: r.rowCount ?? 0 };
      },
    });
    await client.query('COMMIT');
  } catch (err) {
    failure = err;
    await client.query('ROLLBACK').catch(() => {});
  } finally {
    client.release(
      failure !== undefined && isConnectionError(failure) ? (failure as Error) : undefined,
    );
  }
  await recordRun(
    { tenant, sql: label, origin: 'system', path: 'system' },
    'write',
    Math.round(performance.now() - started),
    failure === undefined
      ? { rows: [], fields: [], rowCount, truncated: false, durationMs: 0 }
      : undefined,
    failure,
  );
  if (failure !== undefined)
    throw failure instanceof Error ? failure : new Error(JSON.stringify(failure));
  return value as T;
}
