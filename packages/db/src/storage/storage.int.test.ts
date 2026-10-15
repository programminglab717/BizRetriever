import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { databaseAvailable } from '@bizr/platform/testing';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { getAppDb } from '../client';
import { workspace } from '../schema/workspace';
import {
  localStorage,
  postgresStorage,
  sha256Hex,
  StorageNotFoundError,
  uploadKey,
  type Storage,
} from './index';

const dbReady = await databaseAvailable();
const workspaceIds: string[] = [];

async function newWorkspace(): Promise<string> {
  const [row] = await getAppDb()
    .insert(workspace)
    .values({
      name: 'Storage test',
      slug: `storage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tenantSchema: `t_${Math.random().toString(36).slice(2, 12).padEnd(10, 'a')}`,
      packId: 'retail',
      packVersion: '1.0.0',
    })
    .returning({ id: workspace.id });
  workspaceIds.push(row!.id);
  return row!.id;
}

afterAll(async () => {
  for (const id of workspaceIds) await getAppDb().delete(workspace).where(eq(workspace.id, id));
});

async function exercise(storage: Storage, workspaceId: string) {
  const bytes = new TextEncoder().encode('SKU,Name\nM1,Sage Mug\n');
  const key = uploadKey(workspaceId, sha256Hex(bytes));
  await storage.put(key, bytes, workspaceId);
  await storage.put(key, bytes, workspaceId); // idempotent
  expect(new TextDecoder().decode(await storage.get(key))).toBe('SKU,Name\nM1,Sage Mug\n');
  await storage.deleteWorkspace(workspaceId);
  await expect(storage.get(key)).rejects.toThrow(StorageNotFoundError);
}

describe('storage keys', () => {
  it('rejects anything that is not a content-addressed workspace key', async () => {
    const s = localStorage(mkdtempSync(path.join(tmpdir(), 'bizr-store-')));
    await expect(s.get('../../etc/passwd')).rejects.toThrow(/Invalid storage key/);
    expect(() => uploadKey('../x', 'a'.repeat(64))).toThrow();
  });
});

describe('local storage', () => {
  it('stores, reads and deletes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bizr-store-'));
    await exercise(localStorage(dir), '00000000-0000-4000-8000-000000000001');
  });
});

describe.skipIf(!dbReady)('postgres storage', () => {
  it('stores, reads and deletes', async () => {
    await exercise(postgresStorage(), await newWorkspace());
  });
});
