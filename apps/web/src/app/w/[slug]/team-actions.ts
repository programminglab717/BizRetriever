'use server';

import {
  addNote,
  assignInsight,
  listNotes,
  markInsightDone,
  removeNote,
  TeamError,
  type NoteView,
} from '@bizr/core/team';
import { NotAllowedError } from '@bizr/core/workspaces';
import { getLogger } from '@bizr/platform';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireEditor, requireWorkspace } from '@/lib/session';

/** Notes on insights and answers, and handing insights to people (M13). */

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const subjectSchema = z.object({ kind: z.enum(['insight', 'answer']), id: z.uuid() }).strict();

async function guard<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof TeamError || err instanceof NotAllowedError)
      return { ok: false, error: err.message };
    getLogger('team').error({ err }, 'team action failed');
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

export async function loadNotesAction(slug: string, subject: unknown): Promise<Result<NoteView[]>> {
  const member = await requireWorkspace(slug);
  const s = subjectSchema.safeParse(subject);
  if (!s.success) return { ok: false, error: 'This page is out of date.' };
  return guard(
    async () =>
      (await listNotes(member, member.user.id, s.data.kind, [s.data.id]))[s.data.id] ?? [],
  );
}

export async function addNoteAction(
  slug: string,
  subject: unknown,
  body: string,
): Promise<Result<NoteView[]>> {
  const member = await requireWorkspace(slug);
  const s = subjectSchema.safeParse(subject);
  if (!s.success) return { ok: false, error: 'This page is out of date.' };
  return guard(async () => {
    await addNote(member, member.user.id, s.data, String(body).slice(0, 2000));
    return (await listNotes(member, member.user.id, s.data.kind, [s.data.id]))[s.data.id] ?? [];
  });
}

export async function removeNoteAction(
  slug: string,
  subject: unknown,
  noteId: string,
): Promise<Result<NoteView[]>> {
  const member = await requireWorkspace(slug);
  const s = subjectSchema.safeParse(subject);
  if (!s.success || !z.uuid().safeParse(noteId).success)
    return { ok: false, error: 'This page is out of date.' };
  return guard(async () => {
    await removeNote(member, member.user.id, noteId);
    return (await listNotes(member, member.user.id, s.data.kind, [s.data.id]))[s.data.id] ?? [];
  });
}

export async function assignAction(
  slug: string,
  insightId: string,
  assigneeId: string | null,
): Promise<Result<null>> {
  const member = await requireEditor(slug);
  if (
    !z.uuid().safeParse(insightId).success ||
    (assigneeId && !z.uuid().safeParse(assigneeId).success)
  )
    return { ok: false, error: 'This page is out of date.' };
  return guard(async () => {
    await assignInsight(member, member.user.id, insightId, assigneeId);
    revalidatePath(`/w/${slug}/home`);
    revalidatePath(`/w/${slug}/insights`);
    return null;
  });
}

export async function doneAction(slug: string, insightId: string): Promise<Result<null>> {
  const member = await requireWorkspace(slug);
  if (!z.uuid().safeParse(insightId).success)
    return { ok: false, error: 'This page is out of date.' };
  return guard(async () => {
    await markInsightDone(member, member.user.id, insightId);
    revalidatePath(`/w/${slug}/home`);
    revalidatePath(`/w/${slug}/insights`);
    return null;
  });
}
