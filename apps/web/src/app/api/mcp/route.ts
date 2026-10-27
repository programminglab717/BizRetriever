import { handleMcpMessage } from '@bizr/core/platform';
import { getEnv, getLogger } from '@bizr/platform';

import { apiError, jsonBody, withApiKey } from '@/lib/api-key';

/**
 * The MCP server (M16, ADR-066): Streamable HTTP without sessions. Each POST holds one JSON-RPC
 * message (or a batch) and gets JSON back; there is no server-sent stream, so GET and DELETE are
 * refused. Signed in with a business's API key as a bearer token.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Browsers send an Origin: only our own pages may call (guards against DNS rebinding). */
function foreignOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return origin !== null && origin !== new URL(getEnv().APP_URL).origin;
}

export async function POST(request: Request): Promise<Response> {
  if (foreignOrigin(request))
    return apiError(403, 'forbidden_origin', 'Not allowed from this site.');
  return withApiKey(request, async (member) => {
    const body = await jsonBody(request);
    const ctx = {
      member,
      onError: (err: unknown, tool: string) =>
        getLogger('mcp').error({ err, tool, workspaceId: member.workspace.id }, 'tool failed'),
    };
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((m) => handleMcpMessage(m, ctx)))).filter(Boolean);
      return out.length ? Response.json(out) : new Response(null, { status: 202 });
    }
    const out = await handleMcpMessage(body, ctx);
    return out ? Response.json(out) : new Response(null, { status: 202 });
  });
}

const notHere = () => new Response(null, { status: 405, headers: { allow: 'POST' } });

export const GET = notHere;
export const DELETE = notHere;
