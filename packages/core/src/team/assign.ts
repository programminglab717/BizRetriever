import { auditEvent, getAppDb, insight, note, user, workspaceMember } from '@bizr/db';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { canChange, requireEditor, type MemberWorkspace } from '../workspaces/service';
import { TeamError } from './notes';

/**
 * Handing an insight to a person to deal with (M13, ADR-062). It shows on their Home under "For
 * you" and in their weekly email; marking it done clears it and leaves a note saying so. Only people
 * who can change things can be given one, and only they hand them out.
 */

export interface Teammate {
  id: string;
  name: string;
}

/** People an insight can be handed to: active owners and members. */
export async function teammates(member: MemberWorkspace): Promise<Teammate[]> {
  const rows = await getAppDb()
    .select({ id: user.id, name: user.name, role: workspaceMember.role })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(
      and(
        eq(workspaceMember.workspaceId, member.workspace.id),
        eq(workspaceMember.status, 'active'),
      ),
    )
    .orderBy(asc(workspaceMember.createdAt));
  return rows.filter((r) => canChange(r.role)).map(({ id, name }) => ({ id, name }));
}

const open = inArray(insight.status, ['new', 'seen']);

/** Hands an insight to someone, or takes it back (`assigneeId` null). */
export async function assignInsight(
  member: MemberWorkspace,
  userId: string,
  insightId: string,
  assigneeId: string | null,
): Promise<void> {
  requireEditor(member);
  if (assigneeId && !(await teammates(member)).some((t) => t.id === assigneeId))
    throw new TeamError('That person can’t be given things to do here.');
  const db = getAppDb();
  await db.transaction(async (tx) => {
    const r = await tx
      .update(insight)
      .set(
        assigneeId
          ? { assignedTo: assigneeId, assignedBy: userId, assignedAt: new Date() }
          : { assignedTo: null, assignedBy: null, assignedAt: null },
      )
      .where(and(eq(insight.id, insightId), eq(insight.workspaceId, member.workspace.id), open))
      .returning({ id: insight.id });
    if (r.length === 0) throw new TeamError('That insight isn’t open any more.');
    await tx.insert(auditEvent).values({
      workspaceId: member.workspace.id,
      userId,
      action: assigneeId ? 'insight.assigned' : 'insight.unassigned',
      details: { insightId, ...(assigneeId ? { to: assigneeId } : {}) },
    });
  });
}

/** The person it was handed to (or anyone who can change things) says it's dealt with. */
export async function markInsightDone(
  member: MemberWorkspace,
  userId: string,
  insightId: string,
): Promise<void> {
  const db = getAppDb();
  const mine = and(eq(insight.id, insightId), eq(insight.workspaceId, member.workspace.id));
  const [row] = await db.select({ assignedTo: insight.assignedTo }).from(insight).where(mine);
  if (!row?.assignedTo) throw new TeamError('That isn’t waiting on anyone.');
  if (row.assignedTo !== userId) requireEditor(member);
  await db.transaction(async (tx) => {
    await tx
      .update(insight)
      .set({ assignedTo: null, assignedBy: null, assignedAt: null })
      .where(mine);
    await tx.insert(note).values({
      workspaceId: member.workspace.id,
      subjectKind: 'insight',
      subjectId: insightId,
      userId,
      body: 'Marked done.',
    });
    await tx.insert(auditEvent).values({
      workspaceId: member.workspace.id,
      userId,
      action: 'insight.done',
      details: { insightId },
    });
  });
}
