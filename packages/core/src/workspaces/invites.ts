import {
  auditEvent,
  getAppDb,
  type MemberRole,
  sha256Hex,
  user,
  workspace,
  workspaceInvite,
  workspaceMember,
} from '@bizr/db';
import { getLogger } from '@bizr/platform';
import { and, asc, eq, gt, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';

import { NotAllowedError, type MemberWorkspace } from './service';

/**
 * Inviting people to a business (PRODUCT_SPEC Settings, M6). Owners invite by email; the link
 * carries a random token (only its hash is stored), works once, for the invited address, within
 * 7 days. Members can do everything except inviting, removing people and deleting the business;
 * viewers (M13) can look, ask, download and leave notes. The owner picks the role and can change it.
 */

export const INVITE_DAYS = 7;
export class InviteError extends Error {}

/** The roles the owner can give someone (there is one owner). */
export const assignableRoles = ['member', 'viewer'] as const;
export type AssignableRole = (typeof assignableRoles)[number];
const roleSchema = z.enum(assignableRoles);

const emailSchema = z.email().max(254);
const hashOf = (token: string) => sha256Hex(new TextEncoder().encode(token));
const log = () => getLogger('invites');

function requireOwner(member: MemberWorkspace, what: string) {
  if (member.role !== 'owner') throw new NotAllowedError(`Only the owner can ${what}.`);
}

export interface MemberList {
  members: {
    userId: string;
    name: string;
    email: string;
    role: MemberRole;
    joinedAt: Date;
  }[];
  invites: { id: string; email: string; role: MemberRole; sentAt: Date; expiresAt: Date }[];
}

export async function listMembers(member: MemberWorkspace): Promise<MemberList> {
  const db = getAppDb();
  const members = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: workspaceMember.role,
      joinedAt: workspaceMember.createdAt,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(
      and(
        eq(workspaceMember.workspaceId, member.workspace.id),
        eq(workspaceMember.status, 'active'),
      ),
    )
    .orderBy(asc(workspaceMember.createdAt));
  const invites =
    member.role === 'owner'
      ? await db
          .select({
            id: workspaceInvite.id,
            email: workspaceInvite.email,
            role: workspaceInvite.role,
            sentAt: workspaceInvite.createdAt,
            expiresAt: workspaceInvite.expiresAt,
          })
          .from(workspaceInvite)
          .where(
            and(
              eq(workspaceInvite.workspaceId, member.workspace.id),
              isNull(workspaceInvite.acceptedAt),
              isNull(workspaceInvite.revokedAt),
              gt(workspaceInvite.expiresAt, new Date()),
            ),
          )
          .orderBy(asc(workspaceInvite.createdAt))
      : [];
  return { members, invites };
}

/** Creates (or renews) an invite. Returns the token for the link; it isn't stored. */
export async function createInvite(
  member: MemberWorkspace,
  inviterId: string,
  rawEmail: string,
  rawRole: AssignableRole = 'member',
): Promise<{ id: string; token: string; email: string }> {
  requireOwner(member, 'invite people');
  const role = roleSchema.safeParse(rawRole);
  if (!role.success) throw new InviteError('Please choose what they can do.');
  const parsed = emailSchema.safeParse(rawEmail.trim().toLowerCase());
  if (!parsed.success) throw new InviteError('Please enter a valid email address.');
  const email = parsed.data;
  const db = getAppDb();
  const [already] = await db
    .select({ id: user.id })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(and(eq(workspaceMember.workspaceId, member.workspace.id), eq(user.email, email)));
  if (already) throw new InviteError(`${email} is already in this business.`);
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const id = await db.transaction(async (tx) => {
    // A new invite replaces any pending one for the same address.
    await tx
      .update(workspaceInvite)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(workspaceInvite.workspaceId, member.workspace.id),
          eq(workspaceInvite.email, email),
          isNull(workspaceInvite.acceptedAt),
          isNull(workspaceInvite.revokedAt),
        ),
      );
    const [row] = await tx
      .insert(workspaceInvite)
      .values({
        workspaceId: member.workspace.id,
        email,
        role: role.data,
        tokenHash: hashOf(token),
        invitedBy: inviterId,
        expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
      })
      .returning({ id: workspaceInvite.id });
    await tx.insert(auditEvent).values({
      workspaceId: member.workspace.id,
      userId: inviterId,
      action: 'member.invited',
      details: { email, role: role.data },
    });
    return row!.id;
  });
  log().info({ workspaceId: member.workspace.id, inviteId: id }, 'invite created');
  return { id, token, email };
}

export async function revokeInvite(
  member: MemberWorkspace,
  userId: string,
  inviteId: string,
): Promise<void> {
  requireOwner(member, 'cancel invitations');
  const db = getAppDb();
  const r = await db
    .update(workspaceInvite)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(workspaceInvite.id, inviteId),
        eq(workspaceInvite.workspaceId, member.workspace.id),
        isNull(workspaceInvite.acceptedAt),
      ),
    )
    .returning({ id: workspaceInvite.id });
  if (r.length === 0) throw new InviteError('That invitation was already used or cancelled.');
  await db.insert(auditEvent).values({
    workspaceId: member.workspace.id,
    userId,
    action: 'member.invite_revoked',
    details: { inviteId },
  });
}

export async function removeMember(
  member: MemberWorkspace,
  userId: string,
  removeUserId: string,
): Promise<void> {
  requireOwner(member, 'remove people');
  if (removeUserId === userId) throw new InviteError('You can’t remove yourself.');
  const db = getAppDb();
  const r = await db
    .delete(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, member.workspace.id),
        eq(workspaceMember.userId, removeUserId),
        ne(workspaceMember.role, 'owner'),
      ),
    )
    .returning({ userId: workspaceMember.userId });
  if (r.length === 0) throw new InviteError('That person isn’t part of this business.');
  await db.insert(auditEvent).values({
    workspaceId: member.workspace.id,
    userId,
    action: 'member.removed',
    details: { userId: removeUserId },
  });
}

/** The owner changes what someone can do (M13). The owner's own role never changes here. */
export async function changeRole(
  member: MemberWorkspace,
  userId: string,
  targetUserId: string,
  rawRole: AssignableRole,
): Promise<void> {
  requireOwner(member, 'change what people can do');
  const role = roleSchema.safeParse(rawRole);
  if (!role.success) throw new InviteError('Please choose what they can do.');
  if (targetUserId === userId) throw new InviteError('You can’t change your own role.');
  const db = getAppDb();
  await db.transaction(async (tx) => {
    const r = await tx
      .update(workspaceMember)
      .set({ role: role.data })
      .where(
        and(
          eq(workspaceMember.workspaceId, member.workspace.id),
          eq(workspaceMember.userId, targetUserId),
          ne(workspaceMember.role, 'owner'),
        ),
      )
      .returning({ userId: workspaceMember.userId });
    if (r.length === 0) throw new InviteError('That person isn’t part of this business.');
    await tx.insert(auditEvent).values({
      workspaceId: member.workspace.id,
      userId,
      action: 'member.role_changed',
      details: { userId: targetUserId, role: role.data },
    });
  });
}

export interface InviteView {
  businessName: string;
  invitedBy: string | null;
  email: string;
  role: MemberRole;
  status: 'pending' | 'used' | 'expired' | 'cancelled';
}

async function findInvite(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return undefined;
  const [row] = await getAppDb()
    .select({
      invite: workspaceInvite,
      businessName: workspace.name,
      slug: workspace.slug,
      inviter: user.name,
    })
    .from(workspaceInvite)
    .innerJoin(workspace, eq(workspace.id, workspaceInvite.workspaceId))
    .leftJoin(user, eq(user.id, workspaceInvite.invitedBy))
    .where(eq(workspaceInvite.tokenHash, hashOf(token)));
  return row;
}

const statusOf = (i: typeof workspaceInvite.$inferSelect): InviteView['status'] =>
  i.acceptedAt
    ? 'used'
    : i.revokedAt
      ? 'cancelled'
      : i.expiresAt < new Date()
        ? 'expired'
        : 'pending';

/** What the invite page shows. Undefined for links that don't exist. */
export async function getInvite(token: string): Promise<InviteView | undefined> {
  const row = await findInvite(token);
  if (!row) return undefined;
  return {
    businessName: row.businessName,
    invitedBy: row.inviter,
    email: row.invite.email,
    role: row.invite.role,
    status: statusOf(row.invite),
  };
}

/** Joins the business. The signed-in person's email must be the one invited. */
export async function acceptInvite(
  token: string,
  u: { id: string; email: string },
): Promise<{ slug: string }> {
  const row = await findInvite(token);
  if (!row) throw new InviteError('This invitation link isn’t valid.');
  const status = statusOf(row.invite);
  if (status === 'used') throw new InviteError('This invitation has already been used.');
  if (status === 'cancelled')
    throw new InviteError('This invitation was cancelled. Ask for a new one.');
  if (status === 'expired')
    throw new InviteError('This invitation has expired. Ask for a new one.');
  if (u.email.trim().toLowerCase() !== row.invite.email)
    throw new InviteError(
      `This invitation is for ${row.invite.email}. Sign in with that email to accept it.`,
    );
  const db = getAppDb();
  await db.transaction(async (tx) => {
    const used = await tx
      .update(workspaceInvite)
      .set({ acceptedAt: new Date(), acceptedBy: u.id })
      .where(
        and(
          eq(workspaceInvite.id, row.invite.id),
          isNull(workspaceInvite.acceptedAt),
          isNull(workspaceInvite.revokedAt),
        ),
      )
      .returning({ id: workspaceInvite.id });
    if (used.length === 0) throw new InviteError('This invitation has already been used.');
    await tx
      .insert(workspaceMember)
      .values({
        workspaceId: row.invite.workspaceId,
        userId: u.id,
        role: row.invite.role,
        invitedBy: row.invite.invitedBy,
      })
      .onConflictDoNothing();
    await tx.insert(auditEvent).values({
      workspaceId: row.invite.workspaceId,
      userId: u.id,
      action: 'member.joined',
      details: { inviteId: row.invite.id },
    });
  });
  return { slug: row.slug };
}
