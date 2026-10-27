import { businessInfo } from '@bizr/core/platform';

import { withApiKey } from '@/lib/api-key';

/** GET /api/v1/business (M16): the business a key belongs to. */
export const dynamic = 'force-dynamic';

export const GET = (request: Request) => withApiKey(request, async (m) => businessInfo(m));
