import { closePools, getAppDb, getPool, user, workspace } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { tenantNames } from '../tenancy/names';
import {
  createWorkspace,
  deleteWorkspace,
  getMemberWorkspace,
  listUserWorkspaces,
  NotAllowedError,
  updateWorkspaceDetails,
} from './service';

const hasDb = await databaseAvailable();

async function makeUser(label: string): Promise<string> {
  const [row] = await getAppDb()
    .insert(user)
    .values({ name: label, email: `${label}-${crypto.randomUUID()}@example.test` })
    .returning({ id: user.id });
  return row!.id;
}

async function schemaExists(name: string): Promise<boolean> {
  const r = await getPool('admin').query('select 1 from pg_namespace where nspname = $1', [name]);
  return r.rowCount === 1;
}

const input = {
  name: 'Fernwood Home & Gift',
  packId: 'retail',
  currency: 'USD',
  timezone: 'America/New_York',
  dateOrder: 'MDY' as const,
};

describe.skipIf(!hasDb)('workspace service (integration)', () => {
  let owner: string;
  let stranger: string;
  const cleanup: string[] = [];

  beforeAll(async () => {
    owner = await makeUser('owner');
    stranger = await makeUser('stranger');
  });

  afterAll(async () => {
    for (const slug of cleanup) {
      const m = await getMemberWorkspace(slug, owner);
      if (m) await deleteWorkspace(m, owner);
    }
    await getAppDb().delete(user).where(eq(user.id, owner));
    await getAppDb().delete(user).where(eq(user.id, stranger));
    await closePools();
  });

  it('creates an active workspace with settings, an owner and a tenant schema', async () => {
    const ws = await createWorkspace(owner, input);
    cleanup.push(ws.slug);
    expect(ws.status).toBe('active');
    expect(ws.packId).toBe('retail');
    expect(ws.slug).toMatch(/^fernwood-home-and-gift-/);
    expect(await schemaExists(ws.tenantSchema)).toBe(true);
    expect(await schemaExists(tenantNames(ws.tenantSchema).snapshotSchema)).toBe(true);

    const member = await getMemberWorkspace(ws.slug, owner);
    expect(member?.role).toBe('owner');
    expect(member?.settings).toMatchObject({ currency: 'USD', dateOrder: 'MDY', piiMasking: true });
    expect((await listUserWorkspaces(owner)).map((m) => m.workspace.id)).toContain(ws.id);
  });

  it('never returns a workspace to someone who is not a member', async () => {
    const ws = await createWorkspace(owner, { ...input, name: 'Private Shop' });
    cleanup.push(ws.slug);
    expect(await getMemberWorkspace(ws.slug, stranger)).toBeUndefined();
    expect(await listUserWorkspaces(stranger)).toEqual([]);
  });

  it('rejects invalid input before touching the database', async () => {
    await expect(createWorkspace(owner, { ...input, name: ' ' })).rejects.toThrow(/at least 2/);
    await expect(createWorkspace(owner, { ...input, timezone: 'Mars/Base' })).rejects.toThrow();
    await expect(createWorkspace(owner, { ...input, packId: 'nope' })).rejects.toThrow(
      /Unknown pack/,
    );
  });

  it('updates business details', async () => {
    const ws = await createWorkspace(owner, { ...input, name: 'Old Name' });
    cleanup.push(ws.slug);
    const member = (await getMemberWorkspace(ws.slug, owner))!;
    await updateWorkspaceDetails(member, owner, {
      name: 'New Name',
      currency: 'GBP',
      timezone: 'Europe/London',
      dateOrder: 'DMY',
    });
    const updated = (await getMemberWorkspace(ws.slug, owner))!;
    expect(updated.workspace.name).toBe('New Name');
    expect(updated.settings).toMatchObject({ currency: 'GBP', dateOrder: 'DMY' });
  });

  it('only lets the owner delete, and deleting removes the data', async () => {
    const ws = await createWorkspace(owner, { ...input, name: 'Short Lived' });
    const member = (await getMemberWorkspace(ws.slug, owner))!;
    await expect(deleteWorkspace({ ...member, role: 'member' }, stranger)).rejects.toThrow(
      NotAllowedError,
    );
    await deleteWorkspace(member, owner);
    expect(await schemaExists(ws.tenantSchema)).toBe(false);
    const gone = await getAppDb().query.workspace.findFirst({ where: eq(workspace.id, ws.id) });
    expect(gone).toBeUndefined();
  });
});
