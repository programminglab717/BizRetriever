import { answer, closePools, conversation, getAppDb, user, workspaceMember } from '@bizr/db';
import { setEmailTransport, type Email } from '@bizr/platform';
import { databaseAvailable } from '@bizr/platform/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { saveEmailPreferences } from '../insights/email';
import {
  createWorkspace,
  deleteWorkspace,
  getMemberWorkspace,
  NotAllowedError,
} from '../workspaces/service';
import { addNote, dismissMention, listNotes, myMentions, TeamError } from './notes';
import { answerTransfer, cancelTransfer, currentTransfer, startTransfer } from './ownership';

/** M19 (ADR-069): handing a business over, and mentioning people in notes. */
const hasDb = await databaseAvailable();

describe.skipIf(!hasDb)('handing over and mentions (integration)', () => {
  const tag = crypto.randomUUID().slice(0, 8);
  const ids: string[] = [];
  const sent: Email[] = [];
  let olive: string;
  let hal: string;
  let vera: string;
  let slug: string;
  let workspaceId: string;
  let answerId: string;
  const as = async (userId: string) => (await getMemberWorkspace(slug, userId))!;
  const newUser = async (name: string) => {
    const [u] = await getAppDb()
      .insert(user)
      .values({ name, email: `${name.replace(' ', '.')}-${tag}@example.test`, emailVerified: true })
      .returning({ id: user.id });
    ids.push(u!.id);
    return u!.id;
  };
  const owners = async () =>
    (
      await getAppDb()
        .select({ userId: workspaceMember.userId })
        .from(workspaceMember)
        .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.role, 'owner')))
    ).map((r) => r.userId);

  beforeAll(async () => {
    olive = await newUser('Olive Park');
    hal = await newUser('Hal Byrne');
    vera = await newUser('Vera Lund');
    const ws = await createWorkspace(olive, {
      name: `Handover ${tag}`,
      packId: 'retail',
      currency: 'USD',
      timezone: 'America/New_York',
      dateOrder: 'MDY',
    });
    slug = ws.slug;
    workspaceId = ws.id;
    await getAppDb()
      .insert(workspaceMember)
      .values([
        { workspaceId: ws.id, userId: hal, role: 'member' },
        { workspaceId: ws.id, userId: vera, role: 'viewer' },
      ]);
    const [c] = await getAppDb()
      .insert(conversation)
      .values({ workspaceId: ws.id, userId: olive, title: 'Sales' })
      .returning({ id: conversation.id });
    const [a] = await getAppDb()
      .insert(answer)
      .values({
        conversationId: c!.id,
        workspaceId: ws.id,
        userId: olive,
        question: 'Sales last week',
        kind: 'query',
        origin: 'rules',
        interpretation: {},
        content: {},
      })
      .returning({ id: answer.id });
    answerId = a!.id;
    setEmailTransport(async (e) => {
      sent.push(e);
    });
  }, 60_000);

  afterAll(async () => {
    setEmailTransport(null);
    const m = await getMemberWorkspace(slug, (await owners())[0]!);
    if (m) await deleteWorkspace(m, m.workspace.createdBy ?? olive).catch(() => {});
    await getAppDb().delete(user).where(inArray(user.id, ids));
    await closePools();
  });

  it('asks for the name, someone in the business, and the owner', async () => {
    const o = await as(olive);
    await expect(
      startTransfer(await as(hal), hal, { toUserId: vera, confirmName: o.workspace.name }),
    ).rejects.toThrow(NotAllowedError);
    await expect(startTransfer(o, olive, { toUserId: hal, confirmName: 'wrong' })).rejects.toThrow(
      /exactly/,
    );
    await expect(
      startTransfer(o, olive, { toUserId: crypto.randomUUID(), confirmName: o.workspace.name }),
    ).rejects.toThrow(/isn’t part/);
    await expect(
      startTransfer(o, olive, { toUserId: olive, confirmName: o.workspace.name }),
    ).rejects.toThrow(/already/);
  });

  it('changes nothing until the person accepts; they can say no', async () => {
    const o = await as(olive);
    sent.length = 0;
    const t = await startTransfer(o, olive, { toUserId: hal, confirmName: o.workspace.name });
    expect(t).toMatchObject({ toName: 'Hal Byrne', forMe: false });
    expect(await owners()).toEqual([olive]);
    expect(sent.map((e) => e.subject)).toEqual([
      `Olive Park wants to make you the owner of ${o.workspace.name}`,
    ]);
    expect(await currentTransfer(await as(hal), hal)).toMatchObject({
      forMe: true,
      fromName: 'Olive Park',
    });
    expect(await currentTransfer(await as(vera), vera)).toBeNull();
    // Only the person asked can answer.
    await expect(answerTransfer(await as(vera), vera, t.id, true)).rejects.toThrow(TeamError);
    expect(await answerTransfer(await as(hal), hal, t.id, false)).toBe('declined');
    expect(await owners()).toEqual([olive]);
    expect(sent.at(-1)!.subject).toBe(`Hal Byrne didn’t take over ${o.workspace.name}`);
  });

  it('lapses after seven days, and the owner can cancel', async () => {
    const o = await as(olive);
    const t = await startTransfer(o, olive, { toUserId: hal, confirmName: o.workspace.name });
    await expect(
      answerTransfer(await as(hal), hal, t.id, true, new Date(Date.now() + 8 * 86_400_000)),
    ).rejects.toThrow(/isn’t waiting/);
    await cancelTransfer(o, olive);
    await expect(answerTransfer(await as(hal), hal, t.id, true)).rejects.toThrow(/isn’t waiting/);
    await expect(cancelTransfer(o, olive)).rejects.toThrow(/no handover/);
  });

  it('on yes, the person becomes the owner and the old owner a member, in one step', async () => {
    const o = await as(olive);
    const t = await startTransfer(o, olive, { toUserId: vera, confirmName: o.workspace.name });
    expect(await answerTransfer(await as(vera), vera, t.id, true)).toBe('accepted');
    expect(await owners()).toEqual([vera]);
    expect((await as(olive)).role).toBe('member');
    expect((await as(hal)).role).toBe('member');
    // The old owner can't hand it over again; the new one can.
    const v = await as(vera);
    await expect(
      startTransfer(await as(olive), olive, { toUserId: hal, confirmName: v.workspace.name }),
    ).rejects.toThrow(NotAllowedError);
    // The database never allows two owners.
    await expect(
      getAppDb()
        .update(workspaceMember)
        .set({ role: 'owner' })
        .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, hal))),
    ).rejects.toThrow();
  });

  it('mentions people named in a note: For you, an email, and once only', async () => {
    const h = await as(hal);
    await saveEmailPreferences(workspaceId, olive, { mentions: false });
    sent.length = 0;
    const note = await addNote(
      h,
      hal,
      { kind: 'answer', id: answerId },
      '@Vera Lund can you check this? cc @olive park and @Nobody',
    );
    // Olive turned these emails off; Vera gets one.
    expect(sent.map((e) => [e.to, e.subject])).toEqual([
      [`Vera.Lund-${tag}@example.test`, `Hal Byrne mentioned you in Handover ${tag}`],
    ]);
    expect(sent[0]!.text).toContain('Sales last week');
    expect(sent[0]!.headers?.['List-Unsubscribe']).toMatch(/k=mention/);
    const notes = await listNotes(h, hal, 'answer', [answerId]);
    expect(notes[answerId]![0]!.mentions.sort()).toEqual(['Olive Park', 'Vera Lund']);
    const mine = await myMentions(await as(vera), vera);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      noteId: note.id,
      author: 'Hal Byrne',
      subject: { kind: 'answer', title: 'Sales last week' },
    });
    expect(await myMentions(h, hal)).toEqual([]);
    await dismissMention(await as(vera), vera, note.id);
    expect(await myMentions(await as(vera), vera)).toEqual([]);
    // Someone else can't dismiss yours.
    expect(await myMentions(await as(olive), olive)).toHaveLength(1);
    await dismissMention(h, hal, note.id);
    expect(await myMentions(await as(olive), olive)).toHaveLength(1);
  });
});
