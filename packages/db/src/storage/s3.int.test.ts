import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import { databaseAvailable } from '@bizr/platform/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getAppDb } from '../client';
import { user } from '../schema/auth';
import { ingestionRun, upload } from '../schema/ingestion';
import { workspace } from '../schema/workspace';
import {
  moveStoredFiles,
  postgresStorage,
  S3Error,
  s3Client,
  s3Storage,
  sha256Hex,
  StorageNotFoundError,
  uploadKey,
  type S3Config,
} from './index';
import { sha256, signV4 } from './sigv4';

/**
 * M17 (ADR-067): the S3 driver against a small S3 in this process that checks every request's
 * signature the way S3 does, keeps objects in memory and lists two keys a page.
 */
const dbReady = await databaseAvailable();
const credentials = { accessKeyId: 'AKIDTEST', secretAccessKey: 'test-secret-key' };

function fakeS3() {
  const objects = new Map<string, Buffer>();
  const seen: { method: string; path: string }[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url!, `http://${req.headers.host}`);
      seen.push({ method: req.method!, path: url.pathname });
      // Check the signature exactly as S3 would.
      const auth = String(req.headers.authorization ?? '');
      const signed = /SignedHeaders=([^,]+)/.exec(auth)?.[1]?.split(';') ?? [];
      const headers = Object.fromEntries(
        signed.filter((h) => h !== 'host').map((h) => [h, String(req.headers[h])]),
      );
      const payloadHash = String(req.headers['x-amz-content-sha256']);
      const expected = signV4({
        method: req.method!,
        url,
        headers,
        payloadHash,
        region: 'auto',
        service: 's3',
        amzDate: String(req.headers['x-amz-date']),
        credentials,
      });
      if (auth !== expected || payloadHash !== sha256(body)) {
        res.statusCode = 403;
        return res.end('<Error><Code>SignatureDoesNotMatch</Code></Error>');
      }
      const [, bucket, ...rest] = url.pathname.split('/');
      const key = rest.map(decodeURIComponent).join('/');
      if (bucket !== 'bizr-files') {
        res.statusCode = 404;
        return res.end('<Error><Code>NoSuchBucket</Code></Error>');
      }
      if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
        const prefix = url.searchParams.get('prefix') ?? '';
        const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
        const start = Number(url.searchParams.get('continuation-token') ?? 0);
        const page = all.slice(start, start + 2);
        const more = start + 2 < all.length;
        return res.end(
          `<ListBucketResult>${page.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('')}<IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + 2}</NextContinuationToken>` : ''}</ListBucketResult>`,
        );
      }
      const obj = objects.get(key);
      switch (req.method) {
        case 'PUT':
          objects.set(key, body);
          return res.end();
        case 'GET':
        case 'HEAD':
          if (!obj) {
            res.statusCode = 404;
            return res.end(
              req.method === 'GET' ? '<Error><Code>NoSuchKey</Code></Error>' : undefined,
            );
          }
          return res.end(req.method === 'GET' ? obj : undefined);
        case 'DELETE':
          objects.delete(key);
          res.statusCode = 204;
          return res.end();
      }
      res.statusCode = 405;
      res.end();
    });
  });
  return { server, objects, seen };
}

describe('the S3 driver', () => {
  const fake = fakeS3();
  let config: S3Config;
  beforeAll(async () => {
    await new Promise<void>((r) => fake.server.listen(0, '127.0.0.1', r));
    config = {
      bucket: 'bizr-files',
      region: 'auto',
      endpoint: `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`,
      pathStyle: true,
      credentials,
    };
  });
  afterAll(() => fake.server.close());

  it('stores once, reads, checks and deletes a business’s files across pages', async () => {
    const s = s3Storage(config);
    const ws = '00000000-0000-4000-8000-0000000000aa';
    const other = '00000000-0000-4000-8000-0000000000bb';
    const files = ['a', 'b', 'c', 'd', 'e'].map((x) =>
      new TextEncoder().encode(`SKU,Name\n${x}\n`),
    );
    for (const f of files) await s.put(uploadKey(ws, sha256Hex(f)), f, ws);
    const theirs = new TextEncoder().encode('someone else');
    await s.put(uploadKey(other, sha256Hex(theirs)), theirs, other);
    const key = uploadKey(ws, sha256Hex(files[0]!));
    const puts = fake.seen.filter((r) => r.method === 'PUT').length;
    await s.put(key, files[0]!, ws); // already there: not written again
    expect(fake.seen.filter((r) => r.method === 'PUT').length).toBe(puts);
    expect(new TextDecoder().decode(await s.get(key))).toBe('SKU,Name\na\n');
    expect(await s.exists(key)).toBe(true);
    await s.deleteWorkspace(ws);
    expect(fake.objects.size).toBe(1); // the other business's file stays
    expect(await s.exists(key)).toBe(false);
    await expect(s.get(key)).rejects.toThrow(StorageNotFoundError);
    await expect(s.get('../../etc/passwd')).rejects.toThrow(/Invalid storage key/);
  });

  it('refuses a wrong secret', async () => {
    const bad = s3Client({ ...config, credentials: { ...credentials, secretAccessKey: 'nope' } });
    await expect(bad.put('w/x', new Uint8Array([1]))).rejects.toThrow(S3Error);
    await expect(bad.put('w/x', new Uint8Array([1]))).rejects.toThrow(/403 SignatureDoesNotMatch/);
  });

  it('addresses AWS by bucket host, and R2 or MinIO by path', async () => {
    const urls: string[] = [];
    const capture = async (u: string) => {
      urls.push(u);
      return new Response(null, { status: 404 });
    };
    await s3Client(
      { ...config, endpoint: undefined, region: 'eu-west-2', pathStyle: false },
      capture,
    ).exists('w/1/2');
    await s3Client(
      { ...config, endpoint: 'https://acc.r2.cloudflarestorage.com', pathStyle: true },
      capture,
    ).exists('w/1/2');
    expect(urls).toEqual([
      'https://bizr-files.s3.eu-west-2.amazonaws.com/w/1/2',
      'https://acc.r2.cloudflarestorage.com/bizr-files/w/1/2',
    ]);
  });

  describe.skipIf(!dbReady)('moving files from Postgres', () => {
    let wsId: string;
    let userId: string;
    afterAll(async () => {
      if (wsId) await getAppDb().delete(workspace).where(eq(workspace.id, wsId));
      if (userId) await getAppDb().delete(user).where(eq(user.id, userId));
    });

    it('copies every upload, checks it, and is safe to run again', async () => {
      const db = getAppDb();
      const [u] = await db
        .insert(user)
        .values({ name: 'Mover', email: `mover-${crypto.randomUUID()}@example.test` })
        .returning({ id: user.id });
      userId = u!.id;
      const [w] = await db
        .insert(workspace)
        .values({
          name: 'Move test',
          slug: `move-${Date.now()}`,
          tenantSchema: `t_${Math.random().toString(36).slice(2, 12).padEnd(10, 'a')}`,
          packId: 'retail',
          packVersion: '1.0.0',
        })
        .returning({ id: workspace.id });
      wsId = w!.id;
      const [run] = await db
        .insert(ingestionRun)
        .values({ workspaceId: wsId, createdBy: userId })
        .returning({ id: ingestionRun.id });
      const pg = postgresStorage();
      const files = ['orders', 'products', 'gone'].map((n) =>
        new TextEncoder().encode(`${n}\n1\n`),
      );
      for (const [i, f] of files.entries()) {
        const key = uploadKey(wsId, sha256Hex(f));
        if (i < 2) await pg.put(key, f, wsId);
        await db.insert(upload).values({
          workspaceId: wsId,
          runId: run!.id,
          position: i,
          fileName: `${i}.csv`,
          sizeBytes: f.byteLength,
          sha256: sha256Hex(f),
          storageKey: key,
        });
      }
      const s3 = s3Storage(config);
      const check = await moveStoredFiles(pg, s3, { dryRun: true, workspaceIds: [wsId] });
      expect(check).toMatchObject({ files: 3, copied: 2, present: 0 });
      expect(await s3.exists(uploadKey(wsId, sha256Hex(files[0]!)))).toBe(false);

      const first = await moveStoredFiles(pg, s3, { workspaceIds: [wsId] });
      expect(first).toMatchObject({ files: 3, copied: 2, present: 0, damaged: [] });
      expect(first.missing).toEqual([uploadKey(wsId, sha256Hex(files[2]!))]);
      expect(new TextDecoder().decode(await s3.get(uploadKey(wsId, sha256Hex(files[1]!))))).toBe(
        'products\n1\n',
      );
      // Nothing left the source.
      expect(await pg.exists(uploadKey(wsId, sha256Hex(files[0]!)))).toBe(true);

      const again = await moveStoredFiles(pg, s3, { workspaceIds: [wsId] });
      expect(again).toMatchObject({ copied: 0, present: 2 });

      // A file that changed in the destination is reported, not trusted.
      fake.objects.set(uploadKey(wsId, sha256Hex(files[0]!)), Buffer.from('tampered'));
      expect((await moveStoredFiles(pg, s3, { workspaceIds: [wsId] })).damaged).toEqual([
        uploadKey(wsId, sha256Hex(files[0]!)),
      ]);
    });
  });
});
