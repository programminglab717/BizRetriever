import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { findRepoRoot, getEnv } from '@bizr/platform';
import { and, eq, like } from 'drizzle-orm';

import { getAppDb, type AppDb } from '../client';
import { storageBlob } from '../schema/ingestion';

/**
 * File storage for uploaded originals (ADR-013). Keys are content-addressed per workspace
 * (`w/<workspace>/<sha256>`), and stored bytes are never modified.
 */
export interface Storage {
  readonly driver: 'local' | 'postgres';
  /** Stores the bytes under `key`. Storing the same key again is a no-op. */
  put(key: string, bytes: Uint8Array, workspaceId: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** Removes everything a workspace stored (used when the workspace is deleted). */
  deleteWorkspace(workspaceId: string): Promise<void>;
}

export class StorageNotFoundError extends Error {}

const KEY = /^w\/[0-9a-f-]{36}\/[0-9a-f]{64}$/;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function uploadKey(workspaceId: string, sha256: string): string {
  const key = `w/${workspaceId}/${sha256}`;
  if (!KEY.test(key)) throw new Error('Invalid storage key');
  return key;
}

function assertKey(key: string) {
  if (!KEY.test(key)) throw new Error(`Invalid storage key: ${key}`);
}

export function localStorage(dir: string): Storage {
  const fileFor = (key: string) => {
    assertKey(key);
    return path.join(dir, ...key.split('/'));
  };
  return {
    driver: 'local',
    async put(key, bytes) {
      const file = fileFor(key);
      await mkdir(path.dirname(file), { recursive: true });
      // `wx` never overwrites: content-addressed files are immutable.
      await writeFile(file, bytes, { flag: 'wx' }).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'EEXIST') throw err;
      });
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(fileFor(key)));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT')
          throw new StorageNotFoundError(`No stored file ${key}`);
        throw err;
      }
    },
    async deleteWorkspace(workspaceId) {
      if (!/^[0-9a-f-]{36}$/.test(workspaceId)) throw new Error('Invalid workspace id');
      await rm(path.join(dir, 'w', workspaceId), { recursive: true, force: true });
    },
  };
}

export function postgresStorage(db: AppDb = getAppDb()): Storage {
  return {
    driver: 'postgres',
    async put(key, bytes, workspaceId) {
      assertKey(key);
      await db
        .insert(storageBlob)
        .values({ key, workspaceId, bytes: Buffer.from(bytes), sizeBytes: bytes.byteLength })
        .onConflictDoNothing();
    },
    async get(key) {
      assertKey(key);
      const [row] = await db
        .select({ bytes: storageBlob.bytes })
        .from(storageBlob)
        .where(eq(storageBlob.key, key));
      if (!row) throw new StorageNotFoundError(`No stored file ${key}`);
      return new Uint8Array(row.bytes);
    },
    async deleteWorkspace(workspaceId) {
      await db
        .delete(storageBlob)
        .where(
          and(
            eq(storageBlob.workspaceId, workspaceId),
            like(storageBlob.key, `w/${workspaceId}/%`),
          ),
        );
    },
  };
}

let storage: Storage | undefined;

export function getStorage(): Storage {
  if (storage) return storage;
  const env = getEnv();
  switch (env.STORAGE_DRIVER) {
    case 'local':
      storage = localStorage(
        path.resolve(findRepoRoot(), env.STORAGE_LOCAL_DIR ?? path.join('.data', 'uploads')),
      );
      break;
    case 'postgres':
      storage = postgresStorage();
      break;
    case 's3':
      // Paid production only (ADR-026): built as part of the production upgrade.
      throw new Error('STORAGE_DRIVER=s3 is not available yet; use local or postgres');
  }
  return storage;
}

/** Test helper. */
export function setStorageForTests(s: Storage | undefined): void {
  storage = s;
}
