import {
  answer,
  closePools,
  conversation,
  getAppDb,
  insight,
  user,
  workspaceMember,
} from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getInsights } from '../insights/feed';
import {
  createWorkspace,
  deleteWorkspace,
  getMemberWorkspace,
  NotAllowedError,
  type MemberWorkspace,
} from '../workspaces/service';
import { assignInsight, markInsightDone, teammates } from './assign';
import { addNote, cleanNote, listNotes, removeNote, TeamError } from './notes';

/** M13 (ADR-062): notes and handing insights to people stay inside their business. */
const hasDb = await databaseAvailable();

describe.skipIf(!hasDb)('working as a team (integration)', () => {
  const tag = crypto.randomUUID().slice(0, 8);
  const ids: string[] = [];
  let owner: string;
  let helper: string;
  let watcher: string;
  let ownerWs: MemberWorkspace;
  let helperWs: MemberWorkspace;
  let viewerWs: MemberWorkspace;
  let otherWs: MemberWorkspace;
  let insightId: string;
  let answerId: string;

  const newUser = async (name: string) => {
    const [u] = await getAppDb()
      .insert(user)
      .values({ name, email: `${name}-${tag}@example.test` })
      .returning({ id: user.id });
    ids.push(u!.id);
    return u!.id;
  };
  const business = (name: string, by: string) =>
    createWorkspace(by, {
      name: `${name} ${tag}`,
      packId: 'retail',
      currency: 'USD',
      timezone: 'America/New_York',
      dateOrder: 'MDY',
    });

  beforeAll(async () => {
    owner = await newUser('Olive');
    helper = await newUser('Hal');
    watcher = await newUser('Vera');
    const ws = await business('Team Test', owner);
    const db = getAppDb();
    await db.insert(workspaceMember).values([
      { workspaceId: ws.id, userId: helper, role: 'member' },
      { workspaceId: ws.id, userId: watcher, role: 'viewer' },
    ]);
    ownerWs = (await getMemberWorkspace(ws.slug, owner))!;
    helperWs = (await getMemberWorkspace(ws.slug, helper))!;
    viewerWs = (await getMemberWorkspace(ws.slug, watcher))!;
    const other = await business('Other Shop', owner);
    otherWs = (await getMemberWorkspace(other.slug, owner))!;

    const [i] = await db
      .insert(insight)
      .values({
        workspaceId: ws.id,
        ruleId: 'running_out',
        fingerprint: `running_out:mug:${tag}`,
        category: 'stock',
        level: 'urgent',
        score: 10,
        facts: {},
        headline: [{ text: 'Sage Stoneware Mug will run out in 4 days.' }],
        text: 'Sage Stoneware Mug will run out in 4 days.',
      })
      .returning({ id: insight.id });
    insightId = i!.id;
    const [c] = await db
      .insert(conversation)
      .values({ workspaceId: ws.id, userId: owner, title: 'Sales' })
      .returning({ id: conversation.id });
    const [a] = await db
      .insert(answer)
      .values({
        conversationId: c!.id,
        workspaceId: ws.id,
        userId: owner,
        question: 'Sales last week',
        kind: 'query',
        origin: 'rules',
        interpretation: {},
        content: {},
      })
      .returning({ id: answer.id });
    answerId = a!.id;
  }, 60_000);

  afterAll(async () => {
    if (ownerWs) await deleteWorkspace(ownerWs, owner);
    if (otherWs) await deleteWorkspace(otherWs, owner);
    if (ids.length) await getAppDb().delete(user).where(inArray(user.id, ids));
    await closePools();
  });

  it('cleans what people write', () => {
    expect(cleanNote('  Ordered 50 more\r\n\u0007arriving Friday\n\n\n\nok  ')).toBe(
      'Ordered 50 more\narriving Friday\n\nok',
    );
  });

  it('lets anyone in the business leave a note, viewers too, and only there', async () => {
    await addNote(helperWs, helper, { kind: 'insight', id: insightId }, 'Ordered 50 more.');
    const v = await addNote(
      viewerWs,
      watcher,
      { kind: 'insight', id: insightId },
      '<b>Supplier</b> says Friday',
    );
    await addNote(ownerWs, owner, { kind: 'answer', id: answerId }, 'Higher than I thought');
    await expect(
      addNote(helperWs, helper, { kind: 'insight', id: insightId }, ' \n '),
    ).rejects.toThrow(TeamError);
    await expect(
      addNote(helperWs, helper, { kind: 'insight', id: insightId }, 'x'.repeat(1001)),
    ).rejects.toThrow(/up to 1,000/);
    // Another business's insight can't take a note, nor show one.
    await expect(
      addNote(otherWs, owner, { kind: 'insight', id: insightId }, 'Hello'),
    ).rejects.toThrow(/isn’t here/);
    expect(await listNotes(otherWs, owner, 'insight', [insightId])).toEqual({});

    const notes = await listNotes(viewerWs, watcher, 'insight', [insightId]);
    expect(notes[insightId]!.map((n) => [n.author, n.body, n.canRemove])).toEqual([
      ['Hal', 'Ordered 50 more.', false],
      ['Vera', '<b>Supplier</b> says Friday', true],
    ]);
    expect((await listNotes(viewerWs, watcher, 'answer', [answerId]))[answerId]).toHaveLength(1);

    // The author or the owner deletes a note; nobody else.
    await expect(removeNote(helperWs, helper, v.id)).rejects.toThrow(/Only the person/);
    await expect(removeNote(otherWs, owner, v.id)).rejects.toThrow(/already deleted/);
    await removeNote(ownerWs, owner, v.id);
    expect((await listNotes(ownerWs, owner, 'insight', [insightId]))[insightId]).toHaveLength(1);
  });

  it('hands an insight to someone who can act on it, for their Home only', async () => {
    expect((await teammates(ownerWs)).map((t) => t.name)).toEqual(['Olive', 'Hal']);
    await expect(assignInsight(ownerWs, owner, insightId, watcher)).rejects.toThrow(TeamError);
    await expect(assignInsight(viewerWs, watcher, insightId, helper)).rejects.toThrow(
      NotAllowedError,
    );
    await expect(assignInsight(otherWs, owner, insightId, owner)).rejects.toThrow(/isn’t open/);
    await assignInsight(ownerWs, owner, insightId, helper);

    const forHal = await getInsights(helperWs, { assignedTo: helper });
    expect(forHal.insights.map((i) => [i.id, i.assignedTo])).toEqual([[insightId, helper]]);
    expect((await getInsights(ownerWs, { assignedTo: owner })).insights).toEqual([]);

    // Done: off their Home, with a note saying so.
    await expect(markInsightDone(viewerWs, watcher, insightId)).rejects.toThrow(NotAllowedError);
    await markInsightDone(helperWs, helper, insightId);
    expect((await getInsights(helperWs, { assignedTo: helper })).insights).toEqual([]);
    const notes = (await listNotes(ownerWs, owner, 'insight', [insightId]))[insightId]!;
    expect(notes.at(-1)).toMatchObject({ author: 'Hal', body: 'Marked done.' });
    await expect(markInsightDone(helperWs, helper, insightId)).rejects.toThrow(/isn’t waiting/);
  });
});
