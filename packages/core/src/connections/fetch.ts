/**
 * Fetching from a linked source (ADR-058). Never fetches an address a person typed: callers build
 * the URL from an id they parsed, and every hop (redirects included) must be on an allowed host,
 * over https. Responses are size-capped and time-limited. Tests swap the transport.
 */

export class SourceError extends Error {
  /** `needs_attention`: a person must act (sharing, reconnecting); `retry`: try again later. */
  constructor(
    message: string,
    readonly kind: 'needs_attention' | 'retry' = 'retry',
  ) {
    super(message);
  }
}

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;
let transport: FetchImpl | null = null;

/** For tests: answer requests without the network. Pass null to stop. */
export function setConnectorFetch(t: FetchImpl | null): void {
  transport = t;
}

export interface SafeFetchOptions {
  allowHost: (host: string) => boolean;
  maxBytes: number;
  timeoutMs?: number;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  maxRedirects?: number;
}

export interface SafeResponse {
  status: number;
  headers: Headers;
  bytes: Uint8Array;
  /** The address the content finally came from. */
  url: string;
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes)
    throw new SourceError(
      'This is larger than we can bring in at once (25 MB).',
      'needs_attention',
    );
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new SourceError(
        'This is larger than we can bring in at once (25 MB).',
        'needs_attention',
      );
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export async function safeFetch(url: string, o: SafeFetchOptions): Promise<SafeResponse> {
  const impl: FetchImpl = transport ?? ((u, init) => fetch(u, init));
  let current = new URL(url);
  for (let hop = 0; hop <= (o.maxRedirects ?? 5); hop += 1) {
    if (current.protocol !== 'https:' || !o.allowHost(current.hostname.toLowerCase()))
      throw new SourceError('We couldn’t reach this source.', 'needs_attention');
    let res: Response;
    try {
      res = await impl(current.toString(), {
        method: hop === 0 ? (o.method ?? 'GET') : 'GET',
        redirect: 'manual',
        headers: o.headers ?? {},
        ...(hop === 0 && o.body !== undefined ? { body: o.body } : {}),
        signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
      });
    } catch {
      throw new SourceError('We couldn’t reach this source just now. We’ll try again later.');
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) throw new SourceError('We couldn’t reach this source.');
      current = new URL(next, current);
      continue;
    }
    return {
      status: res.status,
      headers: res.headers,
      bytes: await readCapped(res, o.maxBytes),
      url: current.toString(),
    };
  }
  throw new SourceError('We couldn’t reach this source.');
}
