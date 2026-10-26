import { randomBytes } from 'node:crypto';

import { auditEvent, connection, getAppDb, workspace } from '@bizr/db';
import { getLogger } from '@bizr/platform';
import { and, eq } from 'drizzle-orm';

import type { JobEnqueuer } from '../../jobs/define';
import { getMemberWorkspace, type MemberWorkspace } from '../../workspaces/service';
import { SourceError } from '../fetch';
import { connectionSyncJob } from '../jobs';
import { openSecret, sealSecret } from '../secret';
import { authorizeUrl, exchangeCode, normalizeShop, verifyCallback } from './oauth';
import { shopifyGraphql, SHOP_QUERY } from './store';

/**
 * Connecting a Shopify store (ADR-059). `beginShopifyInstall` sends the owner to Shopify with a
 * random state, kept in an encrypted, short-lived cookie with who asked and for which business.
 * `completeShopifyInstall` checks Shopify's signature, that state, the shop and the signed-in
 * person, swaps the code for a token (stored encrypted), and queues the first check of the store,
 * whose import the owner reviews like an upload.
 */

const log = () => getLogger('shopify');
export class ShopifyConnectError extends Error {}

const STATE_TTL_MS = 10 * 60_000;
export const SHOPIFY_STATE_COOKIE = 'bizr_shopify_state';

interface InstallState {
  state: string;
  shop: string;
  workspaceId: string;
  slug: string;
  userId: string;
  exp: number;
}

export function beginShopifyInstall(
  member: MemberWorkspace,
  userId: string,
  shopInput: string,
  now = Date.now(),
): { url: string; cookie: string; maxAgeSeconds: number } {
  const shop = normalizeShop(shopInput);
  if (!shop)
    throw new ShopifyConnectError(
      'Please enter your store’s Shopify address, like your-store.myshopify.com.',
    );
  const state = randomBytes(24).toString('base64url');
  const cookie = sealSecret({
    state,
    shop,
    workspaceId: member.workspace.id,
    slug: member.workspace.slug,
    userId,
    exp: now + STATE_TTL_MS,
  } satisfies InstallState);
  return { url: authorizeUrl(shop, state), cookie, maxAgeSeconds: STATE_TTL_MS / 1000 };
}

/** Back from Shopify. Returns the business's slug to send the owner to. */
export async function completeShopifyInstall(input: {
  params: URLSearchParams;
  cookie: string | undefined;
  sessionUserId: string | undefined;
  queue: { enqueue: JobEnqueuer };
  now?: Date;
}): Promise<{ slug: string; connectionId: string }> {
  const now = input.now ?? new Date();
  const refuse = () =>
    new ShopifyConnectError('That connection didn’t work. Please start again from My data.');
  if (!verifyCallback(input.params) || !input.cookie || !input.sessionUserId) throw refuse();
  let saved: InstallState;
  try {
    saved = openSecret<InstallState>(input.cookie);
  } catch {
    throw refuse();
  }
  const shop = normalizeShop(input.params.get('shop') ?? '');
  const code = input.params.get('code');
  if (
    saved.exp < now.getTime() ||
    saved.state !== input.params.get('state') ||
    !shop ||
    shop !== saved.shop ||
    saved.userId !== input.sessionUserId ||
    !code
  )
    throw refuse();
  const member = await getMemberWorkspace(saved.slug, saved.userId);
  if (!member || member.workspace.id !== saved.workspaceId || member.workspace.status !== 'active')
    throw refuse();

  let tokens;
  let name: string;
  try {
    tokens = await exchangeCode(shop, code, now);
    name = (await shopifyGraphql<{ shop: { name: string } }>(shop, tokens.accessToken, SHOP_QUERY))
      .shop.name;
  } catch (err) {
    log().warn({ err, shop }, 'shopify install failed');
    throw new ShopifyConnectError(
      err instanceof SourceError ? err.message : 'Shopify didn’t answer. Please try again.',
    );
  }

  const db = getAppDb();
  const values = {
    name: name.slice(0, 120) || shop,
    secret: sealSecret(tokens),
    status: 'active' as const,
    lastError: null,
    lastCheckedAt: null,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(connection)
    .values({
      workspaceId: member.workspace.id,
      kind: 'shopify',
      externalId: shop,
      createdBy: saved.userId,
      ...values,
    })
    .onConflictDoUpdate({
      target: [connection.workspaceId, connection.kind, connection.externalId],
      set: { ...values, createdBy: saved.userId },
    })
    .returning({ id: connection.id });
  const connectionId = row!.id;
  await db.insert(auditEvent).values({
    workspaceId: member.workspace.id,
    userId: saved.userId,
    action: 'connection.linked',
    details: { connectionId, kind: 'shopify', shop },
  });
  // The first look at the store runs in the background; its import waits for the owner.
  await input.queue.enqueue(
    connectionSyncJob,
    { connectionId },
    { workspaceId: member.workspace.id },
  );
  return { slug: member.workspace.slug, connectionId };
}

/**
 * Shopify's webhooks: the app was removed (stop, forget the token), and the privacy requests every
 * app must honour. Personal data requests are recorded for the team to act on within 30 days
 * (RUNBOOK_SHOPIFY.md); the record holds Shopify's ids, not the person's details.
 */
export async function handleShopifyWebhook(
  topic: string,
  shopHeader: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const shop = normalizeShop(shopHeader);
  if (!shop) return;
  const db = getAppDb();
  const rows = await db
    .select({ id: connection.id, workspaceId: connection.workspaceId })
    .from(connection)
    .innerJoin(workspace, eq(workspace.id, connection.workspaceId))
    .where(and(eq(connection.kind, 'shopify'), eq(connection.externalId, shop)));
  if (topic === 'app/uninstalled' || topic === 'shop/redact')
    await db
      .update(connection)
      .set({
        status: 'disconnected',
        secret: null,
        lastError: 'BizRetriever was removed from this Shopify store. Your records stay.',
        updatedAt: new Date(),
      })
      .where(and(eq(connection.kind, 'shopify'), eq(connection.externalId, shop)));
  const ids = (key: string) => {
    const v = payload[key];
    return Array.isArray(v) ? v.filter((x) => typeof x === 'number' || typeof x === 'string') : [];
  };
  const customer = payload.customer as { id?: unknown } | undefined;
  for (const r of rows)
    await db.insert(auditEvent).values({
      workspaceId: r.workspaceId,
      userId: null,
      action: `shopify.${topic.replace('/', '.')}`,
      details: {
        connectionId: r.id,
        shop,
        ...(customer && (typeof customer.id === 'number' || typeof customer.id === 'string')
          ? { customerId: customer.id }
          : {}),
        ...(ids('orders_to_redact').length ? { orders: ids('orders_to_redact') } : {}),
        ...(ids('orders_requested').length ? { orders: ids('orders_requested') } : {}),
      },
    });
  log().info({ topic, shop, businesses: rows.length }, 'shopify webhook');
}
