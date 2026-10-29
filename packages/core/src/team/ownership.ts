import {
  auditEvent,
  getAppDb,
  ownershipTransfer,
  user,
  workspaceMember,
  type OwnershipTransfer,
} from '@bizr/db';
import { translator, type Translator } from '@bizr/i18n';
import { getEnv, getLogger } from '@bizr/platform';
import { and, eq, gt, isNull } from 'drizzle-orm';

import { claim, deliver } from '../insights/email';
import { readerLanguage, userLanguage } from '../workspaces/language';
import { NotAllowedError, type MemberWorkspace } from '../workspaces/service';
import { TeamError } from './notes';

/**
 * Handing the business to someone already in it (M19, ADR-069). The owner picks the person and
 * types the business's name; nothing changes until that person accepts. Then, in one step, they
 * become the owner and the old owner a member (the database allows only one owner). The owner can
 * cancel, the person can decline, and an unanswered handover lapses after seven days.
 */

export const TRANSFER_DAYS = 7;
const log = () => getLogger('ownership');

export interface TransferView {
  id: string;
  fromName: string;
  toName: string;
  toUserId: string;
  expiresAt: Date;
  /** The person looking is the one being asked. */
  forMe: boolean;
}

const waiting = (workspaceId: string, now: Date) =>
  and(
    eq(ownershipTransfer.workspaceId, workspaceId),
    isNull(ownershipTransfer.decision),
    gt(ownershipTransfer.expiresAt, now),
  );

async function personIn(workspaceId: string, userId: string) {
  const [row] = await getAppDb()
    .select({
      name: user.name,
      email: user.email,
      verified: user.emailVerified,
      role: workspaceMember.role,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.userId, userId),
        eq(workspaceMember.status, 'active'),
      ),
    );
  return row;
}

async function tell(
  member: MemberWorkspace,
  to: { userId: string; email: string; verified: boolean },
  key: string,
  /** Subject and text, in the reader's language (M20). */
  write: (t: Translator) => { subject: string; text: string },
): Promise<void> {
  // Only to addresses the person has confirmed are theirs; Settings shows it either way.
  if (!to.verified) return;
  try {
    const t = translator(readerLanguage(await userLanguage(to.userId), member.settings));
    const { subject, text } = write(t);
    const fresh = await claim(member.workspace.id, to.userId, 'ownership', [key]);
    if (fresh.length === 0) return;
    const link = new URL(`/w/${member.workspace.slug}/settings`, getEnv().APP_URL).toString();
    await deliver(member.workspace.id, to.userId, 'ownership', fresh, {
      to: to.email,
      subject,
      text: `${text}\n\n${link}\n`,
    });
  } catch (err) {
    log().error({ err, workspaceId: member.workspace.id }, 'ownership email failed');
  }
}

/** The handover waiting for an answer, if the person looking is its owner or the one asked. */
export async function currentTransfer(
  member: MemberWorkspace,
  userId: string,
  now = new Date(),
): Promise<TransferView | null> {
  const [t] = await getAppDb()
    .select()
    .from(ownershipTransfer)
    .where(waiting(member.workspace.id, now));
  if (!t || (t.fromUserId !== userId && t.toUserId !== userId)) return null;
  const [from, to] = await Promise.all([
    personIn(member.workspace.id, t.fromUserId),
    personIn(member.workspace.id, t.toUserId),
  ]);
  return {
    id: t.id,
    fromName: from?.name ?? 'The owner',
    toName: to?.name ?? 'Someone who left',
    toUserId: t.toUserId,
    expiresAt: t.expiresAt,
    forMe: t.toUserId === userId,
  };
}

export async function startTransfer(
  member: MemberWorkspace,
  userId: string,
  input: { toUserId: string; confirmName: string },
  now = new Date(),
): Promise<TransferView> {
  if (member.role !== 'owner')
    throw new NotAllowedError('Only the owner can hand the business over.');
  if (member.workspace.isDemo) throw new TeamError('The demo shop can’t be handed over.');
  if (input.confirmName.trim() !== member.workspace.name)
    throw new TeamError('Type the business’s name exactly to confirm.');
  if (input.toUserId === userId) throw new TeamError('You’re already the owner.');
  const to = await personIn(member.workspace.id, input.toUserId);
  if (!to) throw new TeamError('That person isn’t part of this business.');
  const me = await personIn(member.workspace.id, userId);
  const db = getAppDb();
  const t = await db.transaction(async (tx) => {
    // A new handover replaces one still waiting.
    await tx
      .update(ownershipTransfer)
      .set({ decision: 'cancelled', decidedAt: now })
      .where(
        and(
          eq(ownershipTransfer.workspaceId, member.workspace.id),
          isNull(ownershipTransfer.decision),
        ),
      );
    const [row] = await tx
      .insert(ownershipTransfer)
      .values({
        workspaceId: member.workspace.id,
        fromUserId: userId,
        toUserId: input.toUserId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + TRANSFER_DAYS * 86_400_000),
      })
      .returning();
    await tx.insert(auditEvent).values({
      workspaceId: member.workspace.id,
      userId,
      action: 'ownership.offered',
      details: { transferId: row!.id, to: input.toUserId },
    });
    return row!;
  });
  await tell(
    member,
    { userId: input.toUserId, email: to.email, verified: to.verified },
    t.id,
    (tr) => {
      const vars = {
        who: me?.name ?? tr('The owner'),
        business: member.workspace.name,
        days: TRANSFER_DAYS,
      };
      return {
        subject: tr('{who} wants to make you the owner of {business}', vars),
        text: tr(
          "{who} has asked you to become the owner of {business} on BizRetriever. As the owner you'd decide who is part of the business, and could delete it. Nothing changes until you accept, within {days} days, in Settings:",
          vars,
        ),
      };
    },
  );
  return (await currentTransfer(member, userId, now))!;
}

export async function cancelTransfer(
  member: MemberWorkspace,
  userId: string,
  now = new Date(),
): Promise<void> {
  if (member.role !== 'owner') throw new NotAllowedError('Only the owner can cancel a handover.');
  const r = await getAppDb()
    .update(ownershipTransfer)
    .set({ decision: 'cancelled', decidedAt: now })
    .where(waiting(member.workspace.id, now))
    .returning({ id: ownershipTransfer.id });
  if (r.length === 0) throw new TeamError('There’s no handover waiting.');
  await getAppDb()
    .insert(auditEvent)
    .values({
      workspaceId: member.workspace.id,
      userId,
      action: 'ownership.cancelled',
      details: { transferId: r[0]!.id },
    });
}

/**
 * The person asked says yes or no. On yes the roles swap in one transaction, and only if the one
 * who asked is still the owner and the person is still in the business.
 */
export async function answerTransfer(
  member: MemberWorkspace,
  userId: string,
  transferId: string,
  accept: boolean,
  now = new Date(),
): Promise<'accepted' | 'declined'> {
  const db = getAppDb();
  const done = await db.transaction(async (tx) => {
    const [t] = (await tx
      .select()
      .from(ownershipTransfer)
      .where(and(eq(ownershipTransfer.id, transferId), waiting(member.workspace.id, now)))
      .for('update')) as OwnershipTransfer[];
    if (!t || t.toUserId !== userId)
      throw new TeamError('That handover isn’t waiting for you any more.');
    if (!accept) {
      await tx
        .update(ownershipTransfer)
        .set({ decision: 'declined', decidedAt: now })
        .where(eq(ownershipTransfer.id, t.id));
      await tx.insert(auditEvent).values({
        workspaceId: member.workspace.id,
        userId,
        action: 'ownership.declined',
        details: { transferId: t.id },
      });
      return t;
    }
    const inBusiness = (id: string) =>
      and(
        eq(workspaceMember.workspaceId, member.workspace.id),
        eq(workspaceMember.userId, id),
        eq(workspaceMember.status, 'active'),
      );
    // The old owner steps down first: the database allows only one owner at a time.
    const stepped = await tx
      .update(workspaceMember)
      .set({ role: 'member' })
      .where(and(inBusiness(t.fromUserId), eq(workspaceMember.role, 'owner')))
      .returning({ userId: workspaceMember.userId });
    if (stepped.length === 0) throw new TeamError('The person who asked isn’t the owner any more.');
    const raised = await tx
      .update(workspaceMember)
      .set({ role: 'owner' })
      .where(inBusiness(userId))
      .returning({ userId: workspaceMember.userId });
    if (raised.length === 0) throw new TeamError('You aren’t part of this business any more.');
    await tx
      .update(ownershipTransfer)
      .set({ decision: 'accepted', decidedAt: now })
      .where(eq(ownershipTransfer.id, t.id));
    await tx.insert(auditEvent).values({
      workspaceId: member.workspace.id,
      userId,
      action: 'ownership.transferred',
      details: { transferId: t.id, from: t.fromUserId, to: userId },
    });
    return t;
  });
  const [from, to] = await Promise.all([
    personIn(member.workspace.id, done.fromUserId),
    personIn(member.workspace.id, userId),
  ]);
  if (from)
    await tell(
      member,
      { userId: done.fromUserId, email: from.email, verified: from.verified },
      `${done.id}:${accept ? 'accepted' : 'declined'}`,
      (tr) => {
        const vars = { who: to?.name ?? tr('They'), business: member.workspace.name };
        return accept
          ? {
              subject: tr('{who} is now the owner of {business}', vars),
              text: tr(
                "{who} accepted, and is now the owner of {business}. You're still part of the business, as a member.",
                vars,
              ),
            }
          : {
              subject: tr('{who} didn’t take over {business}', vars),
              text: tr("{who} said no, so you're still the owner of {business}.", vars),
            };
      },
    );
  return accept ? 'accepted' : 'declined';
}
