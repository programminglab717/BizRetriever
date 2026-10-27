import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4 for S3-compatible storage (M17, ADR-067): AWS S3, Cloudflare R2, MinIO,
 * Backblaze B2. Written out instead of pulling in an SDK: about 60 lines, checked against AWS's
 * own published examples in `sigv4.test.ts`.
 */

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export const sha256 = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');

const hmac = (key: string | Buffer, data: string) =>
  createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding, as SigV4 wants it (encodeURIComponent leaves !'()* alone). */
export const uriEncode = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export interface SignInput {
  method: string;
  url: URL;
  /** Lower-case names. `host` is added from the URL. */
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  service: string;
  /** `YYYYMMDDTHHMMSSZ` */
  amzDate: string;
  credentials: Credentials;
}

export function amzDate(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** The `Authorization` header for a request. */
export function signV4(i: SignInput): string {
  const headers: Record<string, string> = { ...i.headers, host: i.url.host };
  const names = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const canonicalHeaders = names
    .map((h) => `${h}:${String(headers[h]).trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const signedHeaders = names.join(';');
  const query = [...i.url.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  // S3 paths are encoded once, segment by segment.
  const path = i.url.pathname
    .split('/')
    .map((s) => uriEncode(decodeURIComponent(s)))
    .join('/');
  const canonical = [
    i.method,
    path || '/',
    query,
    canonicalHeaders,
    signedHeaders,
    i.payloadHash,
  ].join('\n');
  const day = i.amzDate.slice(0, 8);
  const scope = `${day}/${i.region}/${i.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', i.amzDate, scope, sha256(canonical)].join('\n');
  let key = hmac(`AWS4${i.credentials.secretAccessKey}`, day);
  for (const part of [i.region, i.service, 'aws4_request']) key = hmac(key, part);
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${i.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}
