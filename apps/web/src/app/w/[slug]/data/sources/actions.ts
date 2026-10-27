'use server';

import {
  ConnectionError,
  connectionSyncJob,
  getConnection,
  linkGoogleSheet,
  unlinkConnection,
  updateConnection,
} from '@bizr/core/connections';
import { IngestionRequestError } from '@bizr/core/ingestion';
import { getLogger } from '@bizr/platform';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { kickJobs } from '@/lib/imports';
import { getJobQueue } from '@/lib/jobs';
import { requireEditor } from '@/lib/session';

export type SourceResult<T = null> = { ok: true; value: T } | { ok: false; error: string };

async function guard<T>(
  slug: string,
  what: string,
  fn: () => Promise<T>,
): Promise<SourceResult<T>> {
  try {
    const value = await fn();
    kickJobs();
    revalidatePath(`/w/${slug}/data`);
    return { ok: true, value };
  } catch (err) {
    if (err instanceof ConnectionError || err instanceof IngestionRequestError)
      return { ok: false, error: err.message };
    getLogger('connections').error({ err, slug, what }, 'source action failed');
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

const id = z.uuid();

/** "Link a Google Sheet": fetches it and starts its first import, which the owner then checks. */
export async function linkSheetAction(
  slug: string,
  link: string,
): Promise<SourceResult<{ runId: string }>> {
  const member = await requireEditor(slug);
  const text = String(link).slice(0, 2_000);
  return guard(slug, 'link', async () => {
    const { runId } = await linkGoogleSheet({
      member,
      userId: member.user.id,
      link: text,
      queue: await getJobQueue(),
    });
    return { runId };
  });
}

/** "Update now". */
export async function syncNowAction(slug: string, connectionId: string): Promise<SourceResult> {
  const member = await requireEditor(slug);
  if (!id.safeParse(connectionId).success) return { ok: false, error: 'This page is out of date.' };
  return guard(slug, 'sync', async () => {
    // Only this business's sources: this refuses any other id.
    await getConnection(member, connectionId);
    const queue = await getJobQueue();
    await queue.enqueue(connectionSyncJob, { connectionId }, { workspaceId: member.workspace.id });
    return null;
  });
}

export async function updateSourceAction(
  slug: string,
  connectionId: string,
  change: { paused?: boolean; autoUpdate?: boolean },
): Promise<SourceResult> {
  const member = await requireEditor(slug);
  const parsed = z
    .object({ paused: z.boolean(), autoUpdate: z.boolean() })
    .partial()
    .strict()
    .safeParse(change);
  if (!id.safeParse(connectionId).success || !parsed.success)
    return { ok: false, error: 'This page is out of date.' };
  return guard(slug, 'update', async () => {
    await updateConnection(member, member.user.id, connectionId, parsed.data);
    return null;
  });
}

/** "Stop updating from this": the records it brought in stay. */
export async function unlinkSourceAction(
  slug: string,
  connectionId: string,
): Promise<SourceResult> {
  const member = await requireEditor(slug);
  if (!id.safeParse(connectionId).success) return { ok: false, error: 'This page is out of date.' };
  return guard(slug, 'unlink', async () => {
    await unlinkConnection(member, member.user.id, connectionId);
    return null;
  });
}
