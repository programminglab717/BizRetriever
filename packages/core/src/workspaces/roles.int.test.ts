import { closePools, getAppDb, user } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pinAnswer, unpinTile } from '../ask/service';
import { linkGoogleSheet, unlinkConnection, updateConnection } from '../connections/service';
import { beginShopifyInstall } from '../connections/shopify/service';
import { planDashboardEdit } from '../dashboard/plan';
import { applyDashboardEdit, saveDashboardRange, undoDashboardEdit } from '../dashboard/service';
import { approveRun, cancelRun, mergeRun, startIngestion, undoRun } from '../ingestion/service';
import { dismissInsight, saveAlertSetting } from '../insights/feed';
import { removeGoal, setGoal } from '../planning/goals';
import { deleteRecords, editRecord, restoreRecords, undoRecordEdit } from '../records/service';
import { applyRecordWrite } from '../records/write';
import { planRecordWrite } from '../records/write-plan';
import { renameLabel } from '../semantic/service';
import { planStructureChange } from '../structure/plan';
import { makeStructuralChange, undoStructuralChange } from '../structure/service';
import {
  acceptInvite,
  changeRole,
  createInvite,
  getInvite,
  InviteError,
  listMembers,
  removeMember,
} from './invites';
import {
  createWorkspace,
  deleteWorkspace,
  getMemberWorkspace,
  NotAllowedError,
  updateWorkspaceDetails,
  type MemberWorkspace,
} from './service';

/** M13 (ADR-062): a viewer can look but every core service that changes something refuses them. */
const hasDb = await databaseAvailable();

describe.skipIf(!hasDb)('viewer role (integration)', () => {
  const tag = crypto.randomUUID().slice(0, 8);
  const ids: string[] = [];
  let owner: { id: string; email: string };
  let helper: { id: string; email: string };
  let ownerWs: MemberWorkspace;
  let viewerWs: MemberWorkspace;

  const newUser = async (name: string) => {
    const email = `${name}-${tag}@example.test`;
    const [u] = await getAppDb().insert(user).values({ name, email }).returning({ id: user.id });
    ids.push(u!.id);
    return { id: u!.id, email };
  };

  beforeAll(async () => {
    owner = await newUser('owner');
    helper = await newUser('helper');
    const ws = await createWorkspace(owner.id, {
      name: `Roles Test ${tag}`,
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

  it('invites someone to view', async () => {
    await expect(
      createInvite(ownerWs, owner.id, helper.email, 'owner' as 'member'),
    ).rejects.toThrow(InviteError);
    const { token } = await createInvite(ownerWs, owner.id, helper.email, 'viewer');
    expect(await getInvite(token)).toMatchObject({ role: 'viewer', status: 'pending' });
    expect((await listMembers(ownerWs)).invites).toMatchObject([
      { email: helper.email, role: 'viewer' },
    ]);
    await acceptInvite(token, helper);
    viewerWs = (await getMemberWorkspace(ownerWs.workspace.slug, helper.id))!;
    expect(viewerWs.role).toBe('viewer');
  });

  it('refuses every change from a viewer', async () => {
    const m = viewerWs;
    const u = helper.id;
    const id = crypto.randomUUID();
    const queue = { enqueue: () => Promise.resolve('') } as never;
    const attempts: [string, () => Promise<unknown>][] = [
      ['startIngestion', () => startIngestion({ member: m, userId: u, files: [], queue })],
      ['approveRun', () => approveRun({ member: m, userId: u, runId: id, proposalId: id, queue })],
      ['mergeRun', () => mergeRun({ member: m, userId: u, runId: id, resolutions: {}, queue })],
      ['cancelRun', () => cancelRun(m, id)],
      ['undoRun', () => undoRun(m, u, id)],
      [
        'editRecord',
        () => editRecord({ member: m, userId: u, entity: 'product', id, changes: {} } as never),
      ],
      [
        'deleteRecords',
        () => deleteRecords({ member: m, userId: u, entity: 'product', ids: [id] }),
      ],
      [
        'restoreRecords',
        () => restoreRecords({ member: m, userId: u, entity: 'product', ids: [id] }),
      ],
      ['undoRecordEdit', () => undoRecordEdit(m, id)],
      ['applyRecordWrite', () => applyRecordWrite({ member: m, userId: u, plan: {} as never })],
      ['planRecordWrite', () => planRecordWrite(m, 'add a product called Mug')],
      ['planStructureChange', () => planStructureChange(m, 'add a colour to products')],
      [
        'makeStructuralChange',
        () => makeStructuralChange({ member: m, userId: u, plan: {} as never }),
      ],
      ['undoStructuralChange', () => undoStructuralChange({ member: m, userId: u, version: 1 })],
      ['renameLabel', () => renameLabel(m, u, {} as never)],
      ['applyDashboardEdit', () => applyDashboardEdit(m, u, [])],
      ['undoDashboardEdit', () => undoDashboardEdit(m, u)],
      ['planDashboardEdit', () => planDashboardEdit(m, 'add a sales tile')],
      ['saveDashboardRange', () => saveDashboardRange(m, {} as never)],
      ['pinAnswer', () => pinAnswer(m, id)],
      ['unpinTile', () => unpinTile(m, id)],
      ['dismissInsight', () => dismissInsight(m, u, id, { notUseful: false })],
      ['saveAlertSetting', () => saveAlertSetting(m, u, 'running_out', {} as never)],
      ['setGoal', () => setGoal(m, u, 'net_sales', '1000')],
      ['removeGoal', () => removeGoal(m, u, 'net_sales')],
      [
        'linkGoogleSheet',
        () => linkGoogleSheet({ member: m, userId: u, link: 'https://docs.google.com/x', queue }),
      ],
      ['updateConnection', () => updateConnection(m, u, id, { paused: true })],
      ['unlinkConnection', () => unlinkConnection(m, u, id)],
      ['beginShopifyInstall', () => Promise.resolve().then(() => beginShopifyInstall(m, u, 'x'))],
      [
        'updateWorkspaceDetails',
        () =>
          updateWorkspaceDetails(m, u, {
            name: 'Renamed',
            currency: 'USD',
            timezone: 'America/New_York',
            dateOrder: 'MDY',
          }),
      ],
      ['createInvite', () => createInvite(m, u, `x-${tag}@example.test`)],
      ['changeRole', () => changeRole(m, u, owner.id, 'viewer')],
    ];
    for (const [name, attempt] of attempts)
      await expect(attempt(), name).rejects.toThrow(NotAllowedError);
  });

  it('lets the owner change what someone can do, but not their own role', async () => {
    await expect(changeRole(ownerWs, owner.id, owner.id, 'viewer')).rejects.toThrow(
      /your own role/,
    );
    await changeRole(ownerWs, owner.id, helper.id, 'member');
    const asMember = (await getMemberWorkspace(ownerWs.workspace.slug, helper.id))!;
    expect(asMember.role).toBe('member');
    await expect(removeGoal(asMember, helper.id, 'net_sales')).resolves.toBeUndefined();
    await changeRole(ownerWs, owner.id, helper.id, 'viewer');
    await removeMember(ownerWs, owner.id, helper.id);
    expect(await getMemberWorkspace(ownerWs.workspace.slug, helper.id)).toBeUndefined();
  });
});
