import { runApiQuery } from '@bizr/core/platform';

import { jsonBody, withApiKey } from '@/lib/api-key';

/** POST /api/v1/query (M16): numbers from a typed query, compiled and run by our code. */
export const dynamic = 'force-dynamic';

export const POST = (request: Request) =>
  withApiKey(request, async (m) => runApiQuery(m, await jsonBody(request)));
