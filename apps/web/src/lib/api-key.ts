import 'server-only';

import { authenticateApiKey, bearerKey, ApiError } from '@bizr/core/platform';
import { NotAllowedError, type MemberWorkspace } from '@bizr/core/workspaces';
import { getLogger, withLogContext } from '@bizr/platform';

/**
 * For the public API and the MCP server (M16, ADR-066): the business a request's key belongs to,
 * read as a "can view" member, or a JSON refusal. No cookies are read: a key is the only way in.
 */

const NO_STORE = { 'cache-control': 'no-store' };

export function apiError(status: number, code: string, message: string, headers = {}): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { ...NO_STORE, ...headers } },
  );
}

export async function withApiKey(
  request: Request,
  handle: (member: MemberWorkspace) => Promise<unknown>,
): Promise<Response> {
  const auth = await authenticateApiKey(bearerKey(request.headers.get('authorization')));
  if (!auth.ok)
    return auth.reason === 'rate_limited'
      ? apiError(429, 'rate_limited', 'Too many requests. Wait a moment and try again.', {
          'retry-after': String(auth.retryAfter),
        })
      : apiError(401, 'unauthorized', 'Send a valid key: Authorization: Bearer bzr_…', {
          'www-authenticate': 'Bearer',
        });
  return withLogContext({ workspaceId: auth.member.workspace.id }, async () => {
    try {
      const out = await handle(auth.member);
      return out instanceof Response ? out : Response.json(out, { headers: NO_STORE });
    } catch (err) {
      if (err instanceof ApiError) return apiError(err.status, err.code, err.message);
      if (err instanceof NotAllowedError) return apiError(403, 'not_allowed', err.message);
      getLogger('api').error({ err, path: new URL(request.url).pathname }, 'api request failed');
      return apiError(500, 'server_error', 'Something went wrong. Try again.');
    }
  });
}

/** The request's JSON body, or an ApiError for anything that isn't JSON. */
export async function jsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 64_000) throw new ApiError(400, 'too_large', 'The request is too large.');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, 'invalid_json', 'Send a JSON body.');
  }
}
