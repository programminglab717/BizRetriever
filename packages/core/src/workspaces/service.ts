import {
  auditEvent,
  getAppDb,
  getStorage,
  ingestionRun,
  type MemberRole,
  type Workspace,
  workspace,
  workspaceMember,
  workspaceSettings,
  type WorkspaceSettings,
} from '@bizr/db';
import { getPack } from '@bizr/packs';
import { getLogger } from '@bizr/platform';
import { and, asc, eq } from 'drizzle-orm';

import { deprovisionTenant, provisionTenant } from '../tenancy/provision';
import { newTenantSchemaName } from '../tenancy/names';
import {
  businessSettingsSchema,
  newWorkspaceSchema,
  type BusinessSettings,
  type NewWorkspaceInput,
} from './settings';
import { workspaceSlug } from './slug';

export interface MemberWorkspace {
  workspace: Workspace;
  settings: WorkspaceSettings;
  role: MemberRole;
}

const log = () => getLogger('workspaces');

/**
 * Creates a business: control-plane rows first (status `provisioning`), then its tenant schema and
 * roles, then marks it `active`. If provisioning fails the workspace is left `failed` and can be retried
 * with `retryProvisioning`, because provisioning is idempotent.
 */
export async function createWorkspace(
  userId: string,
  input: NewWorkspaceInput,
  options: { isDemo?: boolean } = {},
): Promise<Workspace> {
  const data = newWorkspaceSchema.parse(input);
  const pack = getPack(data.packId);
  const db = getAppDb();

  const created = await db.transaction(async (tx) => {
    const [ws] = await tx
      .insert(workspace)
      .values({
        name: data.name,
        slug: workspaceSlug(data.name),
        tenantSchema: newTenantSchemaName(),
        packId: pack.manifest.id,
        packVersion: pack.manifest.version,
        isDemo: options.isDemo ?? false,
        createdBy: userId,
      })
      .returning();
    await tx.insert(workspaceSettings).values({
      workspaceId: ws!.id,
      currency: data.currency,
      timezone: data.timezone,
      dateOrder: data.dateOrder,
      language: data.language ?? 'en',
    });
    await tx.insert(workspaceMember).values({ workspaceId: ws!.id, userId, role: 'owner' });
    await tx.insert(auditEvent).values({
      workspaceId: ws!.id,
      userId,
      action: 'workspace.created',
      details: { packId: pack.manifest.id, packVersion: pack.manifest.version },
    });
    return ws!;
  });

  return finishProvisioning(created);
}

/** Re-runs provisioning for a workspace that ended up `failed`. */
export async function retryProvisioning(workspaceId: string): Promise<Workspace> {
  const ws = await getAppDb().query.workspace.findFirst({ where: eq(workspace.id, workspaceId) });
  if (!ws) throw new Error(`Workspace ${workspaceId} not found`);
  if (ws.status === 'active') return ws;
  return finishProvisioning(ws);
}

async function finishProvisioning(ws: Workspace): Promise<Workspace> {
  const db = getAppDb();
  try {
    await provisionTenant(ws.tenantSchema);
  } catch (err) {
    log().error({ err, workspaceId: ws.id }, 'tenant provisioning failed');
    await db
      .update(workspace)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(workspace.id, ws.id));
    throw err;
  }
  const [active] = await db
    .update(workspace)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(workspace.id, ws.id))
    .returning();
  return active!;
}

/** Workspaces a user belongs to, oldest first. */
export async function listUserWorkspaces(userId: string): Promise<MemberWorkspace[]> {
  const rows = await getAppDb()
    .select({ workspace, settings: workspaceSettings, role: workspaceMember.role })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
    .innerJoin(workspaceSettings, eq(workspaceSettings.workspaceId, workspace.id))
    .where(and(eq(workspaceMember.userId, userId), eq(workspaceMember.status, 'active')))
    .orderBy(asc(workspace.createdAt));
  return rows;
}

/**
 * The workspace with this slug, only if the user is an active member. This is the authorization check
 * every workspace page and action must go through: a slug from the URL is never trusted on its own.
 */
export async function getMemberWorkspace(
  slug: string,
  userId: string,
): Promise<MemberWorkspace | undefined> {
  const [row] = await getAppDb()
    .select({ workspace, settings: workspaceSettings, role: workspaceMember.role })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
    .innerJoin(workspaceSettings, eq(workspaceSettings.workspaceId, workspace.id))
    .where(
      and(
        eq(workspace.slug, slug),
        eq(workspaceMember.userId, userId),
        eq(workspaceMember.status, 'active'),
      ),
    )
    .limit(1);
  return row;
}

export async function updateWorkspaceDetails(
  member: MemberWorkspace,
  userId: string,
  input: { name: string } & BusinessSettings,
): Promise<void> {
  requireEditor(member);
  const name = newWorkspaceSchema.shape.name.parse(input.name);
  const settings = businessSettingsSchema.parse(input);
  if (settings.currency !== member.settings.currency && (await hasRecords(member.workspace.id)))
    throw new SettingsLockedError(
      'Your records are kept in this currency, so it can’t change now.',
      'currency',
    );
  const db = getAppDb();
  await db.transaction(async (tx) => {
    await tx
      .update(workspace)
      .set({ name, updatedAt: new Date() })
      .where(eq(workspace.id, member.workspace.id));
    await tx
      .update(workspaceSettings)
      .set({ ...settings, updatedAt: new Date() })
      .where(eq(workspaceSettings.workspaceId, member.workspace.id));
    await tx.insert(auditEvent).values({
      workspaceId: member.workspace.id,
      userId,
      action: 'workspace.settings_updated',
      details: { name, ...settings },
    });
  });
}

export class NotAllowedError extends Error {}

export class SettingsLockedError extends Error {
  constructor(
    message: string,
    readonly field: 'currency',
  ) {
    super(message);
  }
}

/**
 * Whether any import has finished. Amounts are stored in the business's currency (M20), so it is
 * fixed from then on.
 */
export async function hasRecords(workspaceId: string): Promise<boolean> {
  const [row] = await getAppDb()
    .select({ id: ingestionRun.id })
    .from(ingestionRun)
    .where(and(eq(ingestionRun.workspaceId, workspaceId), eq(ingestionRun.status, 'done')))
    .limit(1);
  return Boolean(row);
}

/** Whether a role can change anything in the business (M13: viewers can't). */
export function canChange(role: MemberRole): boolean {
  return role === 'owner' || role === 'member';
}

/**
 * Every core service that changes data, set-up, sources, the dashboard, goals or alerts starts with
 * this, so a viewer is refused however the call arrives (M13, ADR-062).
 */
export function requireEditor(member: Pick<MemberWorkspace, 'role'>): void {
  if (!canChange(member.role))
    throw new NotAllowedError('You can view this business but not change it. Ask the owner.');
}

/**
 * Permanently deletes a business and all of its data. Owners only; the caller must have collected an
 * explicit, typed confirmation (safety rule 3).
 */
export async function deleteWorkspace(member: MemberWorkspace, userId: string): Promise<void> {
  if (member.role !== 'owner') throw new NotAllowedError('Only the owner can delete a business');
  const db = getAppDb();
  await db
    .update(workspace)
    .set({ status: 'deleting', updatedAt: new Date() })
    .where(eq(workspace.id, member.workspace.id));
  await deprovisionTenant(member.workspace.tenantSchema);
  await getStorage().deleteWorkspace(member.workspace.id);
  await db.delete(workspace).where(eq(workspace.id, member.workspace.id));
  log().info({ workspaceId: member.workspace.id, userId }, 'workspace deleted');
}
