import { answer, auditEvent, getAppDb, insight, note, user, type NoteSubject } from '@bizr/db';
import { and, asc, count, eq, inArray } from 'drizzle-orm';

import type { MemberWorkspace } from '../workspaces/service';

/**
 * Notes on insights and answers (M13, ADR-062): short plain text, seen by everyone in the business,
 * viewers included. They are people's words, so they are shown as written, never given to the AI and
 * never read as facts. The author or the owner can delete one.
 */

export class TeamError extends Error {}

export const NOTE_MAX = 1000;
const NOTES_PER_SUBJECT = 200;

export interface NoteView {
  id: string;
  body: string;
  author: string | null;
  createdAt: string;
  /** The person looking can delete it (they wrote it, or they're the owner). */
  canRemove: boolean;
}

/** Trimmed, control characters dropped (line breaks kept), at most 1,000 characters. */
export function cleanNote(raw: string): string {
  return String(raw)
    .replace(/\r\n?/g, '\n')
    .replace(/[^\P{Cc}\n]/gu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function subjectInBusiness(member: MemberWorkspace, kind: NoteSubject, id: string) {
  const table = kind === 'insight' ? insight : answer;
  const [row] = await getAppDb()
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.workspaceId, member.workspace.id)));
  return Boolean(row);
}

export async function addNote(
  member: MemberWorkspace,
  userId: string,
  subject: { kind: NoteSubject; id: string },
  raw: string,
): Promise<{ id: string }> {
  const body = cleanNote(raw);
  if (!body) throw new TeamError('Write something first.');
  if (body.length > NOTE_MAX)
    throw new TeamError(`Notes can be up to ${NOTE_MAX.toLocaleString('en-US')} characters.`);
  if (!(await subjectInBusiness(member, subject.kind, subject.id)))
    throw new TeamError('That isn’t here any more.');
  const db = getAppDb();
  const here = and(
    eq(note.workspaceId, member.workspace.id),
    eq(note.subjectKind, subject.kind),
    eq(note.subjectId, subject.id),
  );
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(note).where(here);
  if (n >= NOTES_PER_SUBJECT) throw new TeamError('This has as many notes as it can take.');
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(note)
      .values({
        workspaceId: member.workspace.id,
        subjectKind: subject.kind,
        subjectId: subject.id,
        userId,
        body,
      })
      .returning({ id: note.id });
    // The words stay in the note; the log only says one was left.
    await tx.insert(auditEvent).values({
      workspaceId: member.workspace.id,
      userId,
      action: 'note.added',
      details: { noteId: row!.id, subject: subject.kind, subjectId: subject.id },
    });
    return { id: row!.id };
  });
}

export async function removeNote(
  member: MemberWorkspace,
  userId: string,
  noteId: string,
): Promise<void> {
  const db = getAppDb();
  const [row] = await db
    .select({ userId: note.userId })
    .from(note)
    .where(and(eq(note.id, noteId), eq(note.workspaceId, member.workspace.id)));
  if (!row) throw new TeamError('That note was already deleted.');
  if (row.userId !== userId && member.role !== 'owner')
    throw new TeamError('Only the person who wrote a note, or the owner, can delete it.');
  await db.transaction(async (tx) => {
    await tx
      .delete(note)
      .where(and(eq(note.id, noteId), eq(note.workspaceId, member.workspace.id)));
    await tx.insert(auditEvent).values({
      workspaceId: member.workspace.id,
      userId,
      action: 'note.removed',
      details: { noteId },
    });
  });
}

/** Notes on each of these, oldest first. */
export async function listNotes(
  member: MemberWorkspace,
  userId: string,
  kind: NoteSubject,
  ids: readonly string[],
): Promise<Record<string, NoteView[]>> {
  const out: Record<string, NoteView[]> = {};
  if (ids.length === 0) return out;
  const rows = await getAppDb()
    .select({
      id: note.id,
      subjectId: note.subjectId,
      body: note.body,
      userId: note.userId,
      author: user.name,
      createdAt: note.createdAt,
    })
    .from(note)
    .leftJoin(user, eq(user.id, note.userId))
    .where(
      and(
        eq(note.workspaceId, member.workspace.id),
        eq(note.subjectKind, kind),
        inArray(note.subjectId, [...new Set(ids)].slice(0, 500)),
      ),
    )
    .orderBy(asc(note.createdAt));
  for (const r of rows)
    (out[r.subjectId] ??= []).push({
      id: r.id,
      body: r.body,
      author: r.author,
      createdAt: r.createdAt.toISOString(),
      canRemove: r.userId === userId || member.role === 'owner',
    });
  return out;
}
