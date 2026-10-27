import { amzDate, sha256, signV4, type Credentials } from './sigv4';

/**
 * The S3-compatible driver (M17, ADR-067) for paid production: AWS S3, Cloudflare R2, MinIO.
 * Same rules as the other drivers: content-addressed keys, never modified. Only `fetch` and our
 * SigV4 signer; tests point it at a small in-process S3.
 */

export interface S3Config {
  bucket: string;
  region: string;
  /** For R2 or MinIO: `https://<account>.r2.cloudflarestorage.com`. Default: AWS for the region. */
  endpoint?: string;
  /** `https://host/bucket/key` instead of `https://bucket.host/key`. */
  pathStyle: boolean;
  credentials: Credentials;
}

export class S3Error extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface S3Client {
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** null when there is no such object. */
  get(key: string): Promise<Uint8Array | null>;
  exists(key: string): Promise<boolean>;
  /** Every key under a prefix, page by page. */
  list(prefix: string): AsyncGenerator<string>;
  delete(key: string): Promise<void>;
}

export function s3Client(config: S3Config, fetchImpl: Fetch = (u, i) => fetch(u, i)): S3Client {
  const base = new URL(config.endpoint ?? `https://s3.${config.region}.amazonaws.com`);
  const urlFor = (key: string, query: Record<string, string> = {}) => {
    const u = new URL(base.href);
    const path = key.split('/').map(encodeURIComponent).join('/');
    if (config.pathStyle)
      u.pathname = `${base.pathname.replace(/\/$/, '')}/${config.bucket}/${path}`;
    else {
      u.hostname = `${config.bucket}.${base.hostname}`;
      u.pathname = `/${path}`;
    }
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return u;
  };

  async function send(method: string, url: URL, body?: Uint8Array): Promise<Response> {
    const payloadHash = sha256(body ?? '');
    const date = amzDate(new Date());
    const headers: Record<string, string> = {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': date,
      ...(body ? { 'content-type': 'application/octet-stream' } : {}),
    };
    const authorization = signV4({
      method,
      url,
      headers,
      payloadHash,
      region: config.region,
      service: 's3',
      amzDate: date,
      credentials: config.credentials,
    });
    return fetchImpl(url.href, {
      method,
      headers: { ...headers, authorization },
      ...(body ? { body: Buffer.from(body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    });
  }

  async function fail(res: Response, what: string): Promise<never> {
    const text = await res.text().catch(() => '');
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? '';
    throw new S3Error(`${what} failed: ${res.status} ${code}`.trim(), res.status);
  }

  return {
    async put(key, bytes) {
      const res = await send('PUT', urlFor(key), bytes);
      if (!res.ok) await fail(res, `Storing ${key}`);
      await res.arrayBuffer();
    },
    async get(key) {
      const res = await send('GET', urlFor(key));
      if (res.status === 404) {
        await res.arrayBuffer();
        return null;
      }
      if (!res.ok) await fail(res, `Reading ${key}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async exists(key) {
      const res = await send('HEAD', urlFor(key));
      await res.arrayBuffer();
      if (res.status === 404) return false;
      if (!res.ok) throw new S3Error(`Checking ${key} failed: ${res.status}`, res.status);
      return true;
    },
    async *list(prefix) {
      let token: string | undefined;
      do {
        const res = await send(
          'GET',
          urlFor('', {
            'list-type': '2',
            prefix,
            ...(token ? { 'continuation-token': token } : {}),
          }),
        );
        if (!res.ok) await fail(res, `Listing ${prefix}`);
        const xml = await res.text();
        for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) yield m[1]!;
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
          ? /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1]
          : undefined;
      } while (token);
    },
    async delete(key) {
      const res = await send('DELETE', urlFor(key));
      await res.arrayBuffer();
      if (!res.ok && res.status !== 404) throw new S3Error(`Deleting ${key} failed`, res.status);
    },
  };
}
