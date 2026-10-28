import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

import { auditEvent, connection, getAppDb } from '@bizr/db';
import { getEnv, getLogger } from '@bizr/platform';
import { z } from 'zod';

import type { JobEnqueuer } from '../jobs/define';
import { isPublicAddress } from '../platform/net';
import {
  canChange,
  getMemberWorkspace,
  requireEditor,
  type MemberWorkspace,
} from '../workspaces/service';
import { SourceError } from './fetch';
import { connectionSyncJob } from './jobs';
import { connectorSecretsEnabled, openSecret, sealSecret } from './secret';
import { apiJson } from './oauth/http';
import type { Connection } from './oauth/provider';
import type { Fetched } from './service';
import {
  decimal,
  shopSheets,
  textOf,
  utcStamp,
  workbookFile,
  type ShopCustomer,
  type ShopOrderLine,
  type ShopProduct,
} from './workbook';

/**
 * WooCommerce (M18, ADR-068). No app to register: the owner types their store's address and
 * approves read-only access on their own WordPress admin (WooCommerce's app authorisation page).
 * The store then posts a read-only REST key to us, together with the sealed token we gave it,
 * which names the store, the business and the person and lasts ten minutes. The key is checked
 * against that store before it is kept (sealed). The store's address is the one a person typed,
 * so every request to it must reach a public internet address (`publicOnly`).
 */

const log = () => getLogger('woocommerce');
const TOKEN_TTL_MS = 10 * 60_000;
export const WOO_FIRST_ORDERS_DAYS = 365;
const MAX_PAGES = 200;
const PER_PAGE = 100;

export class WooConnectError extends Error {}

export function wooEnabled(): boolean {
  return connectorSecretsEnabled() && getEnv().APP_URL.startsWith('https://');
}

/**
 * "shop.example.com", "https://example.com/shop/wp-admin" → "https://example.com/shop"; null for
 * anything that isn't a public https web address.
 */
export function normalizeStore(input: string): string | null {
  let text = input.trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !host.includes('.') ||
    host === 'localhost' ||
    /\.(localhost|local|internal|lan|home\.arpa)$/.test(host) ||
    (isIP(host) !== 0 && !isPublicAddress(host))
  )
    return null;
  const path = url.pathname
    .replace(/\/(wp-admin|wp-login\.php|wp-json|shop|my-account|cart)(\/.*)?$/i, '')
    .replace(/\/+$/, '');
  return `https://${host}${path}`;
}

interface WooToken {
  store: string;
  workspaceId: string;
  slug: string;
  userId: string;
  exp: number;
  nonce: string;
}

interface WooKeys {
  consumerKey: string;
  consumerSecret: string;
}

const appUrl = (path: string) => new URL(path, getEnv().APP_URL).toString();

/** Where to send the owner: their store's own "allow BizRetriever to read" page. */
export function beginWooConnect(
  member: MemberWorkspace,
  userId: string,
  storeInput: string,
  now = Date.now(),
): { url: string; store: string } {
  requireEditor(member);
  if (!wooEnabled()) throw new WooConnectError('WooCommerce isn’t switched on here yet.');
  const store = normalizeStore(storeInput);
  if (!store)
    throw new WooConnectError(
      'Please enter your store’s web address, like https://shop.example.com.',
    );
  const token = sealSecret({
    store,
    workspaceId: member.workspace.id,
    slug: member.workspace.slug,
    userId,
    exp: now + TOKEN_TTL_MS,
    nonce: randomBytes(8).toString('hex'),
  } satisfies WooToken);
  const url = new URL(`${store}/wc-auth/v1/authorize`);
  url.searchParams.set('app_name', 'BizRetriever');
  url.searchParams.set('scope', 'read');
  url.searchParams.set('user_id', token);
  url.searchParams.set('return_url', appUrl('/api/connect/woocommerce/return'));
  url.searchParams.set('callback_url', appUrl('/api/connect/woocommerce/keys'));
  return { url: url.toString(), store };
}

function openToken(raw: unknown, now: number): WooToken | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  try {
    const t = openSecret<WooToken>(raw);
    return t.exp >= now && normalizeStore(t.store) === t.store ? t : null;
  } catch {
    return null;
  }
}

/** Where the store sends the owner back: to My data, or to say it didn't happen. */
export function wooReturnPath(params: URLSearchParams, now = Date.now()): string {
  const t = openToken(params.get('user_id'), now);
  if (!t || params.get('success') !== '1') return '/connect/failed?source=woocommerce&why=declined';
  return `/w/${t.slug}/data?connected=woocommerce`;
}

const keysSchema = z.object({
  key_id: z.union([z.number(), z.string()]).optional(),
  user_id: z.string().min(1).max(2000),
  consumer_key: z.string().regex(/^ck_[A-Za-z0-9]{20,80}$/),
  consumer_secret: z.string().regex(/^cs_[A-Za-z0-9]{20,80}$/),
  key_permissions: z.string().max(40),
});

const basic = (k: WooKeys) =>
  `Basic ${Buffer.from(`${k.consumerKey}:${k.consumerSecret}`).toString('base64')}`;

async function woo<T>(
  store: string,
  keys: WooKeys,
  path: string,
  query: Record<string, string> = {},
) {
  const url = new URL(`${store}/wp-json/wc/v3/${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return apiJson<T>('Your WooCommerce store', url.toString(), {
    token: '',
    headers: { authorization: basic(keys) },
    publicOnly: true,
  });
}

/** The store posts the key here (server to server). Returns false for anything we won't keep. */
export async function receiveWooKeys(
  body: unknown,
  queue: { enqueue: JobEnqueuer },
  now = new Date(),
): Promise<boolean> {
  const parsed = keysSchema.safeParse(body);
  if (!parsed.success) return false;
  const k = parsed.data;
  const t = openToken(k.user_id, now.getTime());
  if (!t || !/read/.test(k.key_permissions)) return false;
  const member = await getMemberWorkspace(t.slug, t.userId);
  if (
    !member ||
    member.workspace.id !== t.workspaceId ||
    member.workspace.status !== 'active' ||
    !canChange(member.role)
  )
    return false;
  const keys: WooKeys = { consumerKey: k.consumer_key, consumerSecret: k.consumer_secret };
  let name: string;
  try {
    // The key must work on the very store the owner typed.
    await woo<unknown[]>(t.store, keys, 'orders', { per_page: '1' });
    const index = await apiJson<{ name?: unknown }>(
      'Your WooCommerce store',
      `${t.store}/wp-json/`,
      {
        token: '',
        publicOnly: true,
      },
    ).catch(() => ({ name: undefined }));
    name = textOf(index.name) ?? new URL(t.store).hostname;
  } catch (err) {
    log().warn({ err, store: t.store }, 'woocommerce key check failed');
    return false;
  }
  const db = getAppDb();
  const values = {
    name: name.slice(0, 120),
    secret: sealSecret(keys),
    status: 'active' as const,
    lastError: null,
    lastCheckedAt: null,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(connection)
    .values({
      workspaceId: t.workspaceId,
      kind: 'woocommerce',
      externalId: t.store,
      createdBy: t.userId,
      ...values,
    })
    .onConflictDoUpdate({
      target: [connection.workspaceId, connection.kind, connection.externalId],
      set: { ...values, createdBy: t.userId },
    })
    .returning({ id: connection.id });
  await db.insert(auditEvent).values({
    workspaceId: t.workspaceId,
    userId: t.userId,
    action: 'connection.linked',
    details: { connectionId: row!.id, kind: 'woocommerce', store: t.store },
  });
  await queue.enqueue(connectionSyncJob, { connectionId: row!.id }, { workspaceId: t.workspaceId });
  return true;
}

// --- Reading the store ---------------------------------------------------------------------------

interface WooProduct {
  id?: unknown;
  type?: unknown;
  attributes?: { option?: unknown }[];
  name?: unknown;
  sku?: unknown;
  price?: unknown;
  status?: unknown;
  stock_quantity?: unknown;
  categories?: { name?: unknown }[];
}
interface WooCustomer {
  first_name?: unknown;
  last_name?: unknown;
  email?: unknown;
  date_created_gmt?: unknown;
  billing?: { phone?: unknown };
}
interface WooOrder {
  number?: unknown;
  id?: unknown;
  status?: unknown;
  date_created_gmt?: unknown;
  currency?: unknown;
  created_via?: unknown;
  billing?: { first_name?: unknown; last_name?: unknown; email?: unknown; company?: unknown };
  line_items?: {
    name?: unknown;
    sku?: unknown;
    quantity?: unknown;
    price?: unknown;
    total?: unknown;
  }[];
}

async function* allPages<T>(
  store: string,
  keys: WooKeys,
  path: string,
  query: Record<string, string> = {},
) {
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const rows = await woo<T[]>(store, keys, path, {
      ...query,
      per_page: String(PER_PAGE),
      page: String(page),
    });
    if (!Array.isArray(rows))
      throw new SourceError('Your WooCommerce store sent something we couldn’t read.');
    yield rows;
    if (rows.length < PER_PAGE) return;
  }
}

const name2 = (a: unknown, b: unknown) => [textOf(a), textOf(b)].filter(Boolean).join(' ') || null;
const gmt = (v: unknown) =>
  typeof v === 'string' && v ? utcStamp(`${v.replace(/Z$/, '')}Z`) : null;

function wooStatus(s: unknown): ShopOrderLine['status'] | null {
  switch (s) {
    case 'completed':
    case 'processing':
    case 'on-hold':
      return 'completed';
    case 'pending':
      return 'pending';
    case 'refunded':
      return 'refunded';
    case 'cancelled':
    case 'failed':
      return 'cancelled';
    default:
      // Drafts and checkout-drafts aren't orders yet.
      return null;
  }
}

export async function readWooStore(c: Connection, now = new Date()): Promise<Fetched> {
  if (!c.secret)
    throw new SourceError(
      'This store isn’t connected any more. Please connect it again.',
      'needs_attention',
    );
  const keys = openSecret<WooKeys>(c.secret);
  const store = c.externalId;
  const products: ShopProduct[] = [];
  for await (const rows of allPages<WooProduct>(store, keys, 'products', { status: 'any' }))
    for (const p of rows) {
      const base = {
        name: textOf(p.name) ?? '(no name)',
        sku: textOf(p.sku),
        category: textOf(p.categories?.[0]?.name),
        supplier: null,
        price: decimal(p.price),
        cost: null,
        inStock: typeof p.stock_quantity === 'number' ? p.stock_quantity : null,
        active: p.status === 'publish',
      };
      // Products with options (sizes, colours) sell as their variations, each with its own SKU.
      if (p.type === 'variable' && typeof p.id === 'number') {
        let any = false;
        for await (const vs of allPages<WooProduct>(store, keys, `products/${p.id}/variations`))
          for (const v of vs) {
            any = true;
            const option = (v.attributes ?? [])
              .map((a) => textOf(a.option))
              .filter(Boolean)
              .join(', ');
            products.push({
              ...base,
              name: option ? `${base.name} - ${option}` : base.name,
              sku: textOf(v.sku) ?? base.sku,
              price: decimal(v.price) ?? base.price,
              inStock: typeof v.stock_quantity === 'number' ? v.stock_quantity : base.inStock,
              active: base.active && v.status !== 'private',
            });
          }
        if (any) continue;
      }
      products.push(base);
    }
  const customers: ShopCustomer[] = [];
  for await (const rows of allPages<WooCustomer>(store, keys, 'customers', { role: 'all' }))
    for (const u of rows)
      customers.push({
        name: name2(u.first_name, u.last_name),
        email: textOf(u.email),
        phone: textOf(u.billing?.phone),
        since: gmt(u.date_created_gmt)?.slice(0, 10) ?? null,
      });
  const since = typeof c.config.ordersCheckedAt === 'string' ? c.config.ordersCheckedAt : null;
  const from = since
    ? new Date(Date.parse(since) - 24 * 3600_000)
    : new Date(now.getTime() - WOO_FIRST_ORDERS_DAYS * 24 * 3600_000);
  const orders: ShopOrderLine[] = [];
  let currency: string | null = null;
  for await (const rows of allPages<WooOrder>(store, keys, 'orders', {
    modified_after: from.toISOString().slice(0, 19),
    dates_are_gmt: 'true',
    orderby: 'date',
    order: 'asc',
  }))
    for (const o of rows) {
      const status = wooStatus(o.status);
      if (!status) continue;
      currency ??= textOf(o.currency);
      for (const li of o.line_items ?? [])
        orders.push({
          order: textOf(o.number) ?? String(o.id),
          date: gmt(o.date_created_gmt),
          status,
          customer:
            textOf(o.billing?.company) ?? name2(o.billing?.first_name, o.billing?.last_name),
          email: textOf(o.billing?.email),
          sku: textOf(li.sku),
          item: textOf(li.name),
          quantity: typeof li.quantity === 'number' ? li.quantity : null,
          unitPrice: decimal(li.price),
          lineTotal: decimal(li.total),
          channel: o.created_via === 'pos' ? 'In store' : 'Online store',
        });
    }
  return {
    name: c.name,
    files: [
      await workbookFile(
        'WooCommerce store.xlsx',
        shopSheets({ products, customers, orders }, currency),
      ),
    ],
    config: { ordersCheckedAt: now.toISOString() },
  };
}
