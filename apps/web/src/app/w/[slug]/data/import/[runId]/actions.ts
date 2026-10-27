'use server';

import {
  approveRun,
  cancelRun,
  IngestionRequestError,
  mergeRun,
  reviseRun,
  undoRun,
  type ReviewAction,
} from '@bizr/core/ingestion';
import { getLogger } from '@bizr/platform';
import { z } from 'zod';

import { kickJobs } from '@/lib/imports';
import { getJobQueue } from '@/lib/jobs';
import { requireEditor } from '@/lib/session';

export interface ActionResult {
  error?: string;
}

const idSchema = z.uuid();
const column = z.union([z.number().int().min(0).max(199), z.enum(['section', 'sheet_name'])]);
const key = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/);

/** What the review screen may send. Effects are re-validated against the proposal by the service. */
const actionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('answer'),
    questionId: z.string().max(40),
    optionId: z.string().max(40),
  }),
  z.object({
    kind: z.literal('correct'),
    label: z.string().min(1).max(300),
    effect: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('ignore_source'), sourceId: z.string().max(40) }),
      z.object({
        kind: z.literal('unmap_field'),
        sourceId: z.string().max(40),
        entity: key,
        field: key,
      }),
      z.object({
        kind: z.literal('map_column'),
        sourceId: z.string().max(40),
        entity: key,
        field: key,
        column,
      }),
    ]),
  }),
  z.object({ kind: z.literal('undo'), index: z.number().int().min(0).max(100) }),
  z.object({ kind: z.literal('note'), text: z.string().min(1).max(2_000) }),
]);

async function run(slug: string, fn: () => Promise<void>): Promise<ActionResult> {
  try {
    await fn();
    kickJobs();
    return {};
  } catch (err) {
    if (err instanceof IngestionRequestError) return { error: err.message };
    getLogger('imports').error({ err, slug }, 'review action failed');
    return { error: 'Something went wrong. Please try again.' };
  }
}

export async function reviewAction(
  slug: string,
  runId: string,
  proposalId: string,
  action: ReviewAction,
): Promise<ActionResult> {
  const member = await requireEditor(slug);
  const parsed = actionSchema.safeParse(action);
  if (
    !parsed.success ||
    !idSchema.safeParse(runId).success ||
    !idSchema.safeParse(proposalId).success
  )
    return { error: 'That change isn’t possible here.' };
  return run(slug, async () =>
    reviseRun({
      member,
      userId: member.user.id,
      runId,
      proposalId,
      action: parsed.data,
      queue: await getJobQueue(),
    }),
  );
}

export async function approveImport(
  slug: string,
  runId: string,
  proposalId: string,
): Promise<ActionResult> {
  const member = await requireEditor(slug);
  if (!idSchema.safeParse(runId).success || !idSchema.safeParse(proposalId).success)
    return { error: 'This page is out of date. Please reload it.' };
  return run(slug, async () =>
    approveRun({ member, userId: member.user.id, runId, proposalId, queue: await getJobQueue() }),
  );
}

export async function cancelImport(slug: string, runId: string): Promise<ActionResult> {
  const member = await requireEditor(slug);
  if (!idSchema.safeParse(runId).success) return { error: 'We couldn’t find that import.' };
  return run(slug, () => cancelRun(member, runId));
}

/** Conflict choices from the merge review: `<record id>:<field>` → keep mine / take the file's. */
const resolutionsSchema = z
  .record(z.string().regex(/^\d{1,18}:[a-z][a-z0-9_]{0,40}$/), z.enum(['mine', 'theirs']))
  .refine((r) => Object.keys(r).length <= 1_000);

/** "Update my data". */
export async function mergeImport(
  slug: string,
  runId: string,
  resolutions: Record<string, 'mine' | 'theirs'>,
): Promise<ActionResult> {
  const member = await requireEditor(slug);
  const parsed = resolutionsSchema.safeParse(resolutions);
  if (!idSchema.safeParse(runId).success || !parsed.success)
    return { error: 'This page is out of date. Please reload it.' };
  return run(slug, async () =>
    mergeRun({
      member,
      userId: member.user.id,
      runId,
      resolutions: parsed.data,
      queue: await getJobQueue(),
    }),
  );
}

/** "Undo this update": new records are hidden and changed details get their old values back. */
export async function undoImport(slug: string, runId: string): Promise<ActionResult> {
  const member = await requireEditor(slug);
  if (!idSchema.safeParse(runId).success) return { error: 'We couldn’t find that import.' };
  return run(slug, async () => {
    await undoRun(member, member.user.id, runId);
  });
}
