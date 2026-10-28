import { getLogger } from '@bizr/platform';

import { safeFetch, SourceError } from '../fetch';
import { expiry, type OAuthTokens } from './provider';

/** Token and API calls shared by the OAuth providers (M18). Hosts are fixed by each provider. */

const log = () => getLogger('connections');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parse(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

/** A token endpoint call: the code swap or a refresh. */
export async function tokenRequest(o: {
  label: string;
  url: string;
  form?: Record<string, string>;
  json?: Record<string, string>;
  /** HTTP Basic with the app's id and secret (QuickBooks, Xero). */
  basic?: { id: string; secret: string };
  now: Date;
}): Promise<OAuthTokens & { raw: Record<string, unknown> }> {
  const host = new URL(o.url).hostname;
  const res = await safeFetch(o.url, {
    allowHost: (h) => h === host,
    maxBytes: 64 * 1024,
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': o.json ? 'application/json' : 'application/x-www-form-urlencoded',
      ...(o.basic
        ? {
            authorization: `Basic ${Buffer.from(`${o.basic.id}:${o.basic.secret}`).toString('base64')}`,
          }
        : {}),
    },
    body: o.json ? JSON.stringify(o.json) : new URLSearchParams(o.form ?? {}).toString(),
    maxRedirects: 0,
  });
  const body = parse(res.bytes) as Record<string, unknown> | null;
  if (res.status === 400 || res.status === 401 || res.status === 403)
    throw new SourceError(
      `${o.label} no longer lets us in. Please connect it again.`,
      'needs_attention',
    );
  if (res.status !== 200 || !body || typeof body.access_token !== 'string' || !body.access_token)
    throw new SourceError(`${o.label} didn’t answer just now. We’ll try again later.`);
  const expiresAt =
    typeof body.expires_at === 'string' && !Number.isNaN(Date.parse(body.expires_at))
      ? new Date(body.expires_at).toISOString()
      : expiry(body.expires_in, o.now);
  const refreshExpiresAt = expiry(
    body.x_refresh_token_expires_in ?? body.refresh_token_expires_in,
    o.now,
  );
  return {
    accessToken: body.access_token,
    ...(typeof body.refresh_token === 'string' ? { refreshToken: body.refresh_token } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(refreshExpiresAt ? { refreshExpiresAt } : {}),
    raw: body,
  };
}

/** Drops the raw answer before tokens are stored. */
export function tokensOnly(t: OAuthTokens & { raw?: unknown }): OAuthTokens {
  const { raw: _, ...tokens } = t;
  return tokens;
}

/**
 * A JSON API call with a bearer token, waiting out rate limits (429, honouring Retry-After up to a
 * minute) and brief outages (5xx), a few tries.
 */
export async function apiJson<T>(
  label: string,
  url: string,
  o: {
    token: string;
    method?: 'GET' | 'POST';
    body?: unknown;
    headers?: Record<string, string>;
    maxBytes?: number;
    publicOnly?: boolean;
  },
): Promise<T> {
  const host = new URL(url).hostname;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await safeFetch(url, {
      allowHost: (h) => h === host,
      maxBytes: o.maxBytes ?? 20 * 1024 * 1024,
      method: o.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
        ...o.headers,
      },
      ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
      maxRedirects: 0,
      timeoutMs: 30_000,
      ...(o.publicOnly ? { publicOnly: true } : {}),
    });
    if (res.status === 401 || res.status === 403)
      throw new SourceError(
        `${label} no longer lets us in. Please connect it again.`,
        'needs_attention',
      );
    if (res.status === 429 || res.status >= 500) {
      const after = Number(res.headers.get('retry-after'));
      await sleep(
        Number.isFinite(after) && after > 0 ? Math.min(after, 60) * 1000 : 1_000 * 2 ** attempt,
      );
      continue;
    }
    if (res.status !== 200) {
      log().warn({ label, status: res.status, path: new URL(url).pathname }, 'source call failed');
      throw new SourceError(`${label} didn’t answer just now. We’ll try again later.`);
    }
    const body = parse(res.bytes);
    if (body === null) throw new SourceError(`${label} sent something we couldn’t read.`);
    return body as T;
  }
  throw new SourceError(`${label} is busy just now. We’ll try again later.`);
}
