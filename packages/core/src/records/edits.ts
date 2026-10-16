import { getPool } from '@bizr/db';

import type { TenantWriter } from '../executor/write';
import { ident } from '../sql/ident';

/**
 * The record edit log (ADR-043): every change to a record made by the app (grid edits, chat writes,
 * re-upload merges) is logged in the tenant's own schema, in the same transaction as the change, so
 * any batch can be undone exactly. It isn't in the semantic catalog, so questions and fallback SQL
 * can never read it.
 */

export const EDIT_TABLE = '_record_edit';
export type EditOrigin = 'grid' | 'chat' | 'reupload';
export type EditOp = 'insert' | 'update' | 'delete' | 'restore';

const ensured = new Set<string>();

/** Creates the edit log for a tenant if it isn't there (idempotent; runs as the schema owner). */
export async function ensureEditLog(schema: string): Promise<void> {
  if (ensured.has(schema)) return;
  const client = await getPool('admin').connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${ident(schema)}.${ident(EDIT_TABLE)} (
        _id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        batch_id uuid NOT NULL,
        entity text NOT NULL,
        table_name text NOT NULL,
        record_id bigint NOT NULL,
        op text NOT NULL CHECK (op IN ('insert', 'update', 'delete', 'restore')),
        before jsonb,
        after jsonb,
        origin text NOT NULL CHECK (origin IN ('grid', 'chat', 'reupload')),
        user_id uuid,
        summary text,
        created_at timestamptz NOT NULL DEFAULT now(),
        undone_at timestamptz
      )`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS ${ident(`${EDIT_TABLE}_record_idx`)} ON ${ident(schema)}.${ident(EDIT_TABLE)} (table_name, record_id, created_at)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS ${ident(`${EDIT_TABLE}_batch_idx`)} ON ${ident(schema)}.${ident(EDIT_TABLE)} (batch_id)`,
    );
    ensured.add(schema);
  } finally {
    client.release();
  }
}

export interface LoggedEdit {
  entity: string;
  tableName: string;
  recordId: string;
  op: EditOp;
  /** Column → value before / after (only the columns that changed; null for inserts / deletes). */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/** Logs edits in the writer's transaction. Values are parameters. */
export async function logEdits(
  writer: TenantWriter,
  batch: { id: string; origin: EditOrigin; userId: string | null; summary: string },
  edits: readonly LoggedEdit[],
): Promise<void> {
  const PER = 500;
  for (let i = 0; i < edits.length; i += PER) {
    const chunk = edits.slice(i, i + PER);
    const params: unknown[] = [];
    const rows = chunk.map((e) => {
      const base = params.length;
      params.push(
        batch.id,
        e.entity,
        e.tableName,
        e.recordId,
        e.op,
        e.before ? JSON.stringify(e.before) : null,
        e.after ? JSON.stringify(e.after) : null,
        batch.origin,
        batch.userId,
        batch.summary,
      );
      return `(${Array.from({ length: 10 }, (_, k) => `$${base + k + 1}`).join(', ')})`;
    });
    await writer.query(
      `INSERT INTO ${ident(EDIT_TABLE)} (batch_id, entity, table_name, record_id, op, before, after, origin, user_id, summary) VALUES ${rows.join(', ')}`,
      params,
    );
  }
}

export class UndoError extends Error {}

/**
 * Undoes a batch, newest edit first: inserted records are soft-deleted (never removed), updates get
 * their old values back, deletes are restored. Refuses when a later edit touched the same record
 * (undo that one first), so nothing the owner did afterwards is lost.
 */
export async function undoBatch(writer: TenantWriter, batchId: string): Promise<{ edits: number }> {
  const { rows } = await writer.query<{
    _id: string;
    table_name: string;
    record_id: string;
    op: EditOp;
    before: Record<string, unknown> | null;
    created_at: Date;
    undone_at: Date | null;
  }>(
    `SELECT _id, table_name, record_id, op, before, created_at, undone_at FROM ${ident(EDIT_TABLE)} WHERE batch_id = $1 ORDER BY _id DESC`,
    [batchId],
  );
  if (rows.length === 0) throw new UndoError('There’s nothing to undo.');
  if (rows.some((r) => r.undone_at)) throw new UndoError('That was already undone.');
  const later = await writer.query<{ n: string }>(
    `SELECT count(*) AS n FROM ${ident(EDIT_TABLE)} e
     WHERE e.undone_at IS NULL AND e.batch_id <> $1
       AND e._id > (SELECT min(_id) FROM ${ident(EDIT_TABLE)} WHERE batch_id = $1)
       AND (e.table_name, e.record_id) IN (SELECT table_name, record_id FROM ${ident(EDIT_TABLE)} WHERE batch_id = $1)`,
    [batchId],
  );
  if (Number(later.rows[0]?.n ?? 0) > 0)
    throw new UndoError(
      'Some of these records were changed again since. Undo the later change first.',
    );

  for (const r of rows) {
    const table = ident(r.table_name);
    if (r.op === 'insert' || r.op === 'restore')
      await writer.query(
        `UPDATE ${table} SET _deleted_at = now(), _updated_at = now() WHERE _id = $1`,
        [r.record_id],
      );
    else if (r.op === 'delete')
      await writer.query(
        `UPDATE ${table} SET _deleted_at = NULL, _updated_at = now() WHERE _id = $1`,
        [r.record_id],
      );
    else if (r.before && Object.keys(r.before).length) {
      const cols = Object.keys(r.before);
      const sets = cols.map((c, i) => `${ident(c)} = $${i + 2}`);
      await writer.query(
        `UPDATE ${table} SET ${sets.join(', ')}, _updated_at = now() WHERE _id = $1`,
        [r.record_id, ...cols.map((c) => r.before![c] ?? null)],
      );
    }
  }
  await writer.query(`UPDATE ${ident(EDIT_TABLE)} SET undone_at = now() WHERE batch_id = $1`, [
    batchId,
  ]);
  return { edits: rows.length };
}
