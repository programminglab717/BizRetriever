import { listMeasures } from '@bizr/core/platform';

import { withApiKey } from '@/lib/api-key';

/** GET /api/v1/measures (M16): what can be measured, and the details to break it down by. */
export const dynamic = 'force-dynamic';

export const GET = (request: Request) => withApiKey(request, (m) => listMeasures(m));
