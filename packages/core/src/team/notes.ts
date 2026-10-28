import {
  answer,
  auditEvent,
  getAppDb,
  insight,
  note,
  noteMention,
  user,
  workspaceMember,
  type NoteSubject,
} from '@bizr/db';
import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';

import type { MemberWorkspace } from '../workspaces/service';
import { sendMentionEmails } from './mention-email';

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
  /** Names of the people it mentions ("@Sam Lee"), to show them as mentions. */
  mentions: string[];
}

export interface Person {
  id: string;
  name: string;
}

/** Everyone who can be mentioned: the business's active people, viewers too. */
export async function mentionable(member: MemberWorkspace): Promise<Person[]> {
  return getAppDb()
    .select({ id: user.id, name: user.name })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(
      and(
        eq(workspaceMember.workspaceId, member.workspace.id),
        eq(workspaceMember.status, 'active'),
      ),
    )
    .orderBy(asc(user.name));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Who a note names (M19): "@" then a person's full name, not followed by more letters. Longer names
 * first, so "@Sam Lee" isn't also read as "@Sam". Never the author.
 */
export function findMentions(body: string, people: readonly Person[], authorId: string): Person[] {
  let rest = body;
  const found: Person[] = [];
  for (const p of [...people].sort((a, b) => b.name.length - a.name.length)) {
    const name = p.name.trim();
    if (!name || p.id === authorId) continue;
    const re = new RegExp(`@${escapeRe(name)}(?![\\p{L}\\p{N}])`, 'giu');
    if (re.test(rest)) {
      found.push(p);
      rest = rest.replace(re, ' ');
    }
  }
  return found;
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
  const named = body.includes('@') ? findMentions(body, await mentionable(member), userId) : [];
  const added = await db.transaction(async (tx) => {
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
    if (named.length)
      await tx
        .insert(noteMention)
        .values(
          named.map((p) => ({ noteId: row!.id, userId: p.id, workspaceId: member.workspace.id })),
        );
    // The words stay in the note; the log only says one was left, and whom it names.
    await tx.insert(auditEvent).values({
      workspaceId: member.workspace.id,
      userId,
      action: 'note.added',
      details: {
        noteId: row!.id,
        subject: subject.kind,
        subjectId: subject.id,
        ...(named.length ? { mentions: named.map((p) => p.id) } : {}),
      },
    });
    return { id: row!.id };
  });
  if (named.length) await sendMentionEmails(member, userId, added.id, subject, body, named);
  return added;
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
  const db = getAppDb();
  const rows = await db
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
  const named = rows.length
    ? await db
        .select({ noteId: noteMention.noteId, name: user.name })
        .from(noteMention)
        .innerJoin(user, eq(user.id, noteMention.userId))
        .where(
          inArray(
            noteMention.noteId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  for (const r of rows)
    (out[r.subjectId] ??= []).push({
      id: r.id,
      body: r.body,
      author: r.author,
      createdAt: r.createdAt.toISOString(),
      canRemove: r.userId === userId || member.role === 'owner',
      mentions: named.filter((m) => m.noteId === r.id).map((m) => m.name),
    });
  return out;
}

// --- Mentions on Home ----------------------------------------------------------------------------

export interface MentionView {
  noteId: string;
  author: string | null;
  body: string;
  createdAt: string;
  subject: { kind: NoteSubject; id: string; title: string; conversationId?: string };
}

/** Notes naming this person that they haven't dismissed, newest first (for "For you"). */
export async function myMentions(
  member: MemberWorkspace,
  userId: string,
  limit = 10,
): Promise<MentionView[]> {
  const db = getAppDb();
  const rows = await db
    .select({
      noteId: note.id,
      body: note.body,
      createdAt: note.createdAt,
      kind: note.subjectKind,
      subjectId: note.subjectId,
      author: user.name,
    })
    .from(noteMention)
    .innerJoin(note, eq(note.id, noteMention.noteId))
    .leftJoin(user, eq(user.id, note.userId))
    .where(
      and(
        eq(noteMention.workspaceId, member.workspace.id),
        eq(noteMention.userId, userId),
        isNull(noteMention.seenAt),
      ),
    )
    .orderBy(desc(note.createdAt))
    .limit(limit);
  if (rows.length === 0) return [];
  const insightIds = rows.filter((r) => r.kind === 'insight').map((r) => r.subjectId);
  const answerIds = rows.filter((r) => r.kind === 'answer').map((r) => r.subjectId);
  const [insights, answers] = await Promise.all([
    insightIds.length
      ? db
          .select({ id: insight.id, text: insight.text })
          .from(insight)
          .where(inArray(insight.id, insightIds))
      : [],
    answerIds.length
      ? db
          .select({
            id: answer.id,
            question: answer.question,
            conversationId: answer.conversationId,
          })
          .from(answer)
          .where(inArray(answer.id, answerIds))
      : [],
  ]);
  return rows.map((r) => {
    const a = answers.find((x) => x.id === r.subjectId);
    return {
      noteId: r.noteId,
      author: r.author,
      body: r.body,
      createdAt: r.createdAt.toISOString(),
      subject: {
        kind: r.kind,
        id: r.subjectId,
        title:
          (r.kind === 'insight' ? insights.find((x) => x.id === r.subjectId)?.text : a?.question) ??
          'Something that isn’t there any more',
        ...(a ? { conversationId: a.conversationId } : {}),
      },
    };
  });
}

export async function dismissMention(
  member: MemberWorkspace,
  userId: string,
  noteId: string,
): Promise<void> {
  await getAppDb()
    .update(noteMention)
    .set({ seenAt: new Date() })
    .where(
      and(
        eq(noteMention.noteId, noteId),
        eq(noteMention.userId, userId),
        eq(noteMention.workspaceId, member.workspace.id),
      ),
    );
}
