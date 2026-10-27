import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { findRepoRoot, getEnv } from '@bizr/platform';
import { and, eq, like } from 'drizzle-orm';

import { getAppDb, type AppDb } from '../client';
import { storageBlob } from '../schema/ingestion';
import { s3Client, type S3Config } from './s3';

export { S3Error, s3Client, type S3Client, type S3Config } from './s3';

/**
 * File storage for uploaded originals (ADR-013). Keys are content-addressed per workspace
 * (`w/<workspace>/<sha256>`), and stored bytes are never modified.
 */
export type StorageDriver = 'local' | 'postgres' | 's3';

export interface Storage {
  readonly driver: StorageDriver;
  /** Stores the bytes under `key`. Storing the same key again is a no-op. */
  put(key: string, bytes: Uint8Array, workspaceId: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
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
    async exists(key) {
      return access(fileFor(key)).then(
        () => true,
        () => false,
      );
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
    async exists(key) {
      assertKey(key);
      const [row] = await db
        .select({ key: storageBlob.key })
        .from(storageBlob)
        .where(eq(storageBlob.key, key));
      return Boolean(row);
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

/**
 * S3-compatible object storage (M17, ADR-067): AWS S3, Cloudflare R2 or MinIO, for paid production.
 * Objects are written once and never changed; a workspace's are listed by prefix to delete them.
 */
export function s3Storage(config: S3Config, client = s3Client(config)): Storage {
  return {
    driver: 's3',
    async put(key, bytes) {
      assertKey(key);
      if (await client.exists(key)) return;
      await client.put(key, bytes);
    },
    async get(key) {
      assertKey(key);
      const bytes = await client.get(key);
      if (!bytes) throw new StorageNotFoundError(`No stored file ${key}`);
      return bytes;
    },
    async exists(key) {
      assertKey(key);
      return client.exists(key);
    },
    async deleteWorkspace(workspaceId) {
      if (!/^[0-9a-f-]{36}$/.test(workspaceId)) throw new Error('Invalid workspace id');
      const keys: string[] = [];
      for await (const key of client.list(`w/${workspaceId}/`)) keys.push(key);
      // A few at a time: providers throttle bursts.
      for (let i = 0; i < keys.length; i += 8)
        await Promise.all(keys.slice(i, i + 8).map((k) => client.delete(k)));
    },
  };
}

/** The S3 settings from the environment (validated there when STORAGE_DRIVER=s3). */
export function s3ConfigFromEnv(): S3Config {
  const env = getEnv();
  if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)
    throw new Error('S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set');
  if (env.S3_REGION === 'auto' && !env.S3_ENDPOINT)
    throw new Error('Set S3_REGION (AWS) or S3_ENDPOINT (R2, MinIO)');
  return {
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    pathStyle: env.S3_PATH_STYLE ? env.S3_PATH_STYLE === 'on' : Boolean(env.S3_ENDPOINT),
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  };
}

/** A driver by name, set up from the environment (`getStorage` and the move command). */
export function storageFor(driver: StorageDriver): Storage {
  const env = getEnv();
  switch (driver) {
    case 'local':
      return localStorage(
        path.resolve(findRepoRoot(), env.STORAGE_LOCAL_DIR ?? path.join('.data', 'uploads')),
      );
    case 'postgres':
      return postgresStorage();
    case 's3':
      return s3Storage(s3ConfigFromEnv());
  }
}

let storage: Storage | undefined;

export function getStorage(): Storage {
  storage ??= storageFor(getEnv().STORAGE_DRIVER);
  return storage;
}

/** Test helper. */
export function setStorageForTests(s: Storage | undefined): void {
  storage = s;
}

export { moveStoredFiles, type MoveSummary } from './move';
