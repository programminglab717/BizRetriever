import {
  beginShopifyInstall,
  SHOPIFY_STATE_COOKIE,
  shopifyEnabled,
  ShopifyConnectError,
} from '@bizr/core/connections';
import { getEnv } from '@bizr/platform';
import { canChange } from '@bizr/core/workspaces';
import { cookies } from 'next/headers';

import { getSession, workspaceForApi } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** "Connect Shopify" (`?shop=your-store`): off to Shopify to approve, with a short-lived state cookie. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const member = await workspaceForApi(slug);
  const session = await getSession();
  if (!member || !session || !shopifyEnabled())
    return Response.json({ error: 'Not found' }, { status: 404 });
  if (!canChange(member.role))
    return Response.json(
      { error: 'You can view this business but not change it. Ask the owner.' },
      { status: 403 },
    );
  const url = new URL(request.url);
  try {
    const start = beginShopifyInstall(member, session.user.id, url.searchParams.get('shop') ?? '');
    (await cookies()).set(SHOPIFY_STATE_COOKIE, start.cookie, {
      httpOnly: true,
      secure: getEnv().APP_URL.startsWith('https://'),
      sameSite: 'lax',
      path: '/api/connect/shopify',
      maxAge: start.maxAgeSeconds,
    });
    return Response.redirect(start.url, 303);
  } catch (err) {
    if (!(err instanceof ShopifyConnectError)) throw err;
    const back = new URL(`/w/${slug}/data/import`, getEnv().APP_URL);
    back.searchParams.set('shopify', 'bad_shop');
    return Response.redirect(back, 303);
  }
}
