import { askApi } from '@bizr/core/platform';

import { jsonBody, withApiKey } from '@/lib/api-key';

/** POST /api/v1/ask (M16): a question in plain words, answered as Ask would. */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = (request: Request) =>
  withApiKey(request, async (m) => askApi(m, await jsonBody(request)));
