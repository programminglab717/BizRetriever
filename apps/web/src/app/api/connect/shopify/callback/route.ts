import {
  completeShopifyInstall,
  SHOPIFY_STATE_COOKIE,
  shopifyEnabled,
  ShopifyConnectError,
} from '@bizr/core/connections';
import { getEnv, getLogger } from '@bizr/platform';
import { cookies } from 'next/headers';

import { kickJobs } from '@/lib/imports';
import { getJobQueue } from '@/lib/jobs';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Shopify sends the owner back here once they approve. Checked in full before anything is saved. */
export async function GET(request: Request): Promise<Response> {
  // i18n-skip: for Shopify, not a person
  if (!shopifyEnabled()) return Response.json({ error: 'Not found' }, { status: 404 });
  const jar = await cookies();
  const cookie = jar.get(SHOPIFY_STATE_COOKIE)?.value;
  jar.delete({ name: SHOPIFY_STATE_COOKIE, path: '/api/connect/shopify' });
  const session = await getSession();
  const appUrl = getEnv().APP_URL;
  try {
    const { slug } = await completeShopifyInstall({
      params: new URL(request.url).searchParams,
      cookie,
      sessionUserId: session?.user.id,
      queue: await getJobQueue(),
    });
    kickJobs();
    return Response.redirect(new URL(`/w/${slug}/data?connected=shopify`, appUrl), 303);
  } catch (err) {
    if (!(err instanceof ShopifyConnectError))
      getLogger('shopify').error({ err }, 'callback failed');
    const failed = new URL('/connect/shopify/failed', appUrl);
    // A code, not text: the page shows only its own messages.
    failed.searchParams.set(
      'why',
      err instanceof ShopifyConnectError && /didn’t work/.test(err.message) ? 'refused' : 'shopify',
    );
    return Response.redirect(failed, 303);
  }
}
