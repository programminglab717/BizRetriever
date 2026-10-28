import { beginWooConnect, WooConnectError, wooEnabled } from '@bizr/core/connections';
import { canChange } from '@bizr/core/workspaces';
import { getEnv } from '@bizr/platform';

import { getSession, workspaceForApi } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** "Connect WooCommerce" (`?store=…`, M18): off to the store's own approval page. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const member = await workspaceForApi(slug);
  const session = await getSession();
  if (!member || !session || !wooEnabled())
    return Response.json({ error: 'Not found' }, { status: 404 });
  if (!canChange(member.role))
    return Response.json(
      { error: 'You can view this business but not change it. Ask the owner.' },
      { status: 403 },
    );
  try {
    const { url } = beginWooConnect(
      member,
      session.user.id,
      new URL(request.url).searchParams.get('store') ?? '',
    );
    return Response.redirect(url, 303);
  } catch (err) {
    if (!(err instanceof WooConnectError)) throw err;
    const back = new URL(`/w/${slug}/data/import`, getEnv().APP_URL);
    back.searchParams.set('woocommerce', 'bad_store');
    return Response.redirect(back, 303);
  }
}
