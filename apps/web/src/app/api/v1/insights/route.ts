import { listApiInsights } from '@bizr/core/platform';

import { withApiKey } from '@/lib/api-key';

/** GET /api/v1/insights?limit=20 (M16): things worth knowing, most important first. */
export const dynamic = 'force-dynamic';

export const GET = (request: Request) =>
  withApiKey(request, (m) => {
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? 20);
    return listApiInsights(m, { limit: Number.isFinite(limit) ? Math.trunc(limit) : 20 });
  });
