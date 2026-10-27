import { openApiDocument } from '@bizr/core/platform';
import { getEnv } from '@bizr/platform';

/** GET /api/v1/openapi.json (M16): the public API's description. No key needed. */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json(openApiDocument(getEnv().APP_URL), {
    headers: { 'cache-control': 'public, max-age=3600' },
  });
}
