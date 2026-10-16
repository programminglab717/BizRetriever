'use server';

import {
  browseRecords,
  deleteRecords,
  editRecord,
  getRecord,
  RecordsError,
  restoreRecords,
  searchRecords,
  undoRecordEdit,
  type BrowseResult,
  type RecordDetail,
  type RecordRow,
} from '@bizr/core/records';
import { getLogger } from '@bizr/platform';
import { z } from 'zod';

import { requireWorkspace } from '@/lib/session';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const key = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/);
const id = z.string().regex(/^\d{1,18}$/);

async function guard<T>(slug: string, what: string, fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof RecordsError) return { ok: false, error: err.message };
    getLogger('records').error({ err, slug, what }, 'records action failed');
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

const browseSchema = z
  .object({
    entity: key,
    search: z.string().max(100).optional(),
    sort: key.optional(),
    dir: z.enum(['asc', 'desc']).optional(),
    filters: z
      .array(z.object({ field: key, value: z.string().max(100).nullable() }))
      .max(10)
      .optional(),
    offset: z.number().int().min(0).max(1_000_000).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    deleted: z.boolean().optional(),
  })
  .strict();

/** More rows as the grid scrolls. */
export async function loadRecords(slug: string, input: unknown): Promise<Result<BrowseResult>> {
  const member = await requireWorkspace(slug);
  const parsed = browseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'This page is out of date. Please reload it.' };
  return guard(slug, 'browse', () => browseRecords(member, parsed.data));
}

export async function openRecord(
  slug: string,
  entity: string,
  recordId: string,
): Promise<Result<RecordDetail>> {
  const member = await requireWorkspace(slug);
  if (!key.safeParse(entity).success || !id.safeParse(recordId).success)
    return { ok: false, error: 'We couldn’t find that record.' };
  return guard(slug, 'open', () => getRecord(member, entity, recordId));
}

/** For a linked-record editor: matching records to choose from. */
export async function findRecords(
  slug: string,
  entity: string,
  q: string,
): Promise<Result<{ id: string; title: string }[]>> {
  const member = await requireWorkspace(slug);
  if (!key.safeParse(entity).success) return { ok: false, error: 'That link isn’t available.' };
  return guard(slug, 'find', () => searchRecords(member, entity, q.slice(0, 100), 10));
}

const editSchema = z
  .object({
    entity: key,
    id,
    field: key,
    value: z.union([z.string().max(2_000), z.boolean(), z.null()]),
  })
  .strict();

export async function saveEdit(
  slug: string,
  input: unknown,
): Promise<Result<{ batchId: string | null; record: RecordRow | null }>> {
  const member = await requireWorkspace(slug);
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'That change isn’t possible here.' };
  return guard(slug, 'edit', () => editRecord({ member, userId: member.user.id, ...parsed.data }));
}

const idsSchema = z.object({ entity: key, ids: z.array(id).min(1).max(500) }).strict();

export async function removeRecords(
  slug: string,
  input: unknown,
): Promise<Result<{ batchId: string | null; count: number }>> {
  const member = await requireWorkspace(slug);
  const parsed = idsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Choose up to 500 records.' };
  return guard(slug, 'delete', () =>
    deleteRecords({ member, userId: member.user.id, ...parsed.data }),
  );
}

export async function bringBack(
  slug: string,
  input: unknown,
): Promise<Result<{ batchId: string | null; count: number }>> {
  const member = await requireWorkspace(slug);
  const parsed = idsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Choose up to 500 records.' };
  return guard(slug, 'restore', () =>
    restoreRecords({ member, userId: member.user.id, ...parsed.data }),
  );
}

/** The toast's Undo. Returns the records it touched, as they are now, so the grid can update. */
export async function undoChange(
  slug: string,
  entity: string,
  batchId: string,
  recordIds: string[],
): Promise<Result<RecordRow[]>> {
  const member = await requireWorkspace(slug);
  if (
    !key.safeParse(entity).success ||
    !z.uuid().safeParse(batchId).success ||
    !z.array(id).max(500).safeParse(recordIds).success
  )
    return { ok: false, error: 'There’s nothing to undo.' };
  return guard(slug, 'undo', async () => {
    await undoRecordEdit(member, batchId);
    const rows: RecordRow[] = [];
    for (const r of recordIds.slice(0, 50)) rows.push((await getRecord(member, entity, r)).record);
    return rows;
  });
}
