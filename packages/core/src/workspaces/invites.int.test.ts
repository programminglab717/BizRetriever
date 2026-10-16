import { closePools, getAppDb, user } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  acceptInvite,
  createInvite,
  getInvite,
  InviteError,
  listMembers,
  removeMember,
  revokeInvite,
} from './invites';
import {
  createWorkspace,
  deleteWorkspace,
  getMemberWorkspace,
  NotAllowedError,
  type MemberWorkspace,
} from './service';

/** M6: invites by link; only owners invite, remove people or delete the business. */
const hasDb = await databaseAvailable();

describe.skipIf(!hasDb)('member invites (integration)', () => {
  const tag = crypto.randomUUID().slice(0, 8);
  const ids: string[] = [];
  let owner: { id: string; email: string };
  let friend: { id: string; email: string };
  let stranger: { id: string; email: string };
  let ownerWs: MemberWorkspace;

  const newUser = async (name: string) => {
    const email = `${name}-${tag}@example.test`;
    const [u] = await getAppDb().insert(user).values({ name, email }).returning({ id: user.id });
    ids.push(u!.id);
    return { id: u!.id, email };
  };

  beforeAll(async () => {
    owner = await newUser('owner');
    friend = await newUser('friend');
    stranger = await newUser('stranger');
    const ws = await createWorkspace(owner.id, {
      name: `Invite Test ${tag}`,
      packId: 'retail',
      currency: 'USD',
      timezone: 'America/New_York',
      dateOrder: 'MDY',
    });
    ownerWs = (await getMemberWorkspace(ws.slug, owner.id))!;
  }, 60_000);
  afterAll(async () => {
    if (ownerWs) await deleteWorkspace(ownerWs, owner.id);
    if (ids.length) await getAppDb().delete(user).where(inArray(user.id, ids));
    await closePools();
  });

  it('invites by link, for the invited email only, once', async () => {
    await expect(createInvite(ownerWs, owner.id, 'not an email')).rejects.toThrow(InviteError);
    await expect(createInvite(ownerWs, owner.id, owner.email)).rejects.toThrow(
      /already in this business/,
    );
    const { token } = await createInvite(ownerWs, owner.id, friend.email.toUpperCase());
    expect(await getInvite(token)).toMatchObject({
      businessName: `Invite Test ${tag}`,
      invitedBy: 'owner',
      status: 'pending',
      email: friend.email,
    });
    expect((await listMembers(ownerWs)).invites.map((i) => i.email)).toEqual([friend.email]);

    await expect(acceptInvite(token, stranger)).rejects.toThrow(
      `This invitation is for ${friend.email}`,
    );
    const { slug } = await acceptInvite(token, friend);
    expect(slug).toBe(ownerWs.workspace.slug);
    await expect(acceptInvite(token, friend)).rejects.toThrow(/already been used/);
    expect((await getInvite(token))?.status).toBe('used');
    expect(await getInvite('x'.repeat(43))).toBeUndefined();

    const friendWs = (await getMemberWorkspace(slug, friend.id))!;
    expect(friendWs.role).toBe('member');
    expect((await listMembers(ownerWs)).members.map((m) => m.role)).toEqual(['owner', 'member']);
    // Members see who's in, but not invitations, and can't invite, remove or delete.
    expect((await listMembers(friendWs)).invites).toEqual([]);
    await expect(createInvite(friendWs, friend.id, stranger.email)).rejects.toThrow(
      NotAllowedError,
    );
    await expect(removeMember(friendWs, friend.id, owner.id)).rejects.toThrow(NotAllowedError);
    await expect(deleteWorkspace(friendWs, friend.id)).rejects.toThrow(NotAllowedError);
  });

  it('cancels invites, replaces older ones, and removes members', async () => {
    const first = await createInvite(ownerWs, owner.id, stranger.email);
    const second = await createInvite(ownerWs, owner.id, stranger.email);
    expect((await getInvite(first.token))?.status).toBe('cancelled');
    await revokeInvite(ownerWs, owner.id, second.id);
    await expect(acceptInvite(second.token, stranger)).rejects.toThrow(/cancelled/);
    await expect(revokeInvite(ownerWs, owner.id, second.id)).resolves.toBeUndefined();

    await expect(removeMember(ownerWs, owner.id, owner.id)).rejects.toThrow(/yourself/);
    await removeMember(ownerWs, owner.id, friend.id);
    expect(await getMemberWorkspace(ownerWs.workspace.slug, friend.id)).toBeUndefined();
    const [still] = await getAppDb().select().from(user).where(eq(user.id, friend.id));
    expect(still).toBeTruthy(); // their account stays; only the membership goes
  });
});
