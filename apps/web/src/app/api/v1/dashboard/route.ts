import { apiDashboard, ApiError } from '@bizr/core/platform';

import { withApiKey } from '@/lib/api-key';

/** GET /api/v1/dashboard?period=last_30_days&compare=true (M16): the dashboard's tiles. */
export const dynamic = 'force-dynamic';

function rangeFrom(params: URLSearchParams): unknown {
  const period = params.get('period');
  const compare = params.get('compare');
  if (!period && compare === null) return undefined;
  if (compare !== null && compare !== 'true' && compare !== 'false')
    throw new ApiError(400, 'invalid_range', 'compare is true or false.');
  const [from, to] = (period ?? '').split('..');
  return {
    range: !period ? { preset: 'last_30_days' } : to ? { from, to } : { preset: period },
    compare: compare === 'true',
  };
}

export const GET = (request: Request) =>
  withApiKey(request, (m) => apiDashboard(m, rangeFrom(new URL(request.url).searchParams)));
