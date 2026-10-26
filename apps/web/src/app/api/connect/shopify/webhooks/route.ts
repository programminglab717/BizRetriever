import { handleShopifyWebhook, shopifyEnabled, verifyShopifyWebhook } from '@bizr/core/connections';
import { getLogger } from '@bizr/platform';

export const dynamic = 'force-dynamic';

/**
 * Shopify's webhooks: app/uninstalled and the privacy topics (customers/data_request,
 * customers/redact, shop/redact). Signed with the app secret; anything unsigned is refused.
 */
export async function POST(request: Request): Promise<Response> {
  if (!shopifyEnabled()) return new Response('Not found', { status: 404 });
  const raw = await request.text();
  if (raw.length > 1_000_000) return new Response('Too large', { status: 413 });
  if (!verifyShopifyWebhook(raw, request.headers.get('x-shopify-hmac-sha256')))
    return new Response('Unauthorized', { status: 401 });
  const topic = request.headers.get('x-shopify-topic') ?? '';
  const shop = request.headers.get('x-shopify-shop-domain') ?? '';
  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') payload = parsed as Record<string, unknown>;
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  try {
    await handleShopifyWebhook(topic, shop, payload);
  } catch (err) {
    getLogger('shopify').error({ err, topic }, 'webhook failed');
    return new Response('Try again', { status: 500 });
  }
  return new Response('OK', { status: 200 });
}
