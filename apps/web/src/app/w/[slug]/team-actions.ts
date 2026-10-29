'use server';

import {
  addNote,
  assignInsight,
  dismissMention,
  listNotes,
  mentionable,
  markInsightDone,
  removeNote,
  TeamError,
  type NoteView,
  type Person,
} from '@bizr/core/team';
import { NotAllowedError } from '@bizr/core/workspaces';
import { getLogger } from '@bizr/platform';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getT } from '@/lib/i18n';
import { requireEditor, requireWorkspace } from '@/lib/session';

/** Notes on insights and answers, and handing insights to people (M13). */

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** The page sent something it shouldn't have: it was open from before a change. */
async function outOfDate() {
  const t = await getT();
  return { ok: false as const, error: t('This page is out of date.') };
}

const subjectSchema = z.object({ kind: z.enum(['insight', 'answer']), id: z.uuid() }).strict();

async function guard<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    const t = await getT();
    if (err instanceof TeamError || err instanceof NotAllowedError)
      return { ok: false, error: t.text(err.message) };
    getLogger('team').error({ err }, 'team action failed');
    return { ok: false, error: t('Something went wrong. Please try again.') };
  }
}

export async function loadNotesAction(slug: string, subject: unknown): Promise<Result<NoteView[]>> {
  const member = await requireWorkspace(slug);
  const s = subjectSchema.safeParse(subject);
  if (!s.success) return outOfDate();
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
  if (!s.success) return outOfDate();
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
  if (!s.success || !z.uuid().safeParse(noteId).success) return outOfDate();
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
    return outOfDate();
  return guard(async () => {
    await assignInsight(member, member.user.id, insightId, assigneeId);
    revalidatePath(`/w/${slug}/home`);
    revalidatePath(`/w/${slug}/insights`);
    return null;
  });
}

export async function doneAction(slug: string, insightId: string): Promise<Result<null>> {
  const member = await requireWorkspace(slug);
  if (!z.uuid().safeParse(insightId).success) return outOfDate();
  return guard(async () => {
    await markInsightDone(member, member.user.id, insightId);
    revalidatePath(`/w/${slug}/home`);
    revalidatePath(`/w/${slug}/insights`);
    return null;
  });
}

/** Who can be mentioned in a note (M19): everyone in the business. */
export async function mentionablePeople(slug: string): Promise<Result<Person[]>> {
  const member = await requireWorkspace(slug);
  return guard(() => mentionable(member));
}

/** "Got it" on a mention in For you. Only the signed-in person's own. */
export async function dismissMentionAction(slug: string, noteId: string): Promise<Result<null>> {
  const member = await requireWorkspace(slug);
  if (!z.uuid().safeParse(noteId).success) return outOfDate();
  return guard(async () => {
    await dismissMention(member, member.user.id, noteId);
    revalidatePath(`/w/${slug}/home`);
    return null;
  });
}
