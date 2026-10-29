import { wooEnabled, wooReturnPath } from '@bizr/core/connections';
import { getEnv } from '@bizr/platform';

export const dynamic = 'force-dynamic';

/** The store sends the owner back here after they approve or refuse (M18). */
export function GET(request: Request): Response {
  // i18n-skip: for the store, not a person
  if (!wooEnabled()) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.redirect(
    new URL(wooReturnPath(new URL(request.url).searchParams), getEnv().APP_URL),
    303,
  );
}
