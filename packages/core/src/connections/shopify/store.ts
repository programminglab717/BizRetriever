import { connection, getAppDb } from '@bizr/db';
import { getEnv, getLogger } from '@bizr/platform';
import { eq } from 'drizzle-orm';

import { toXlsx } from '../../export/write';
import type { Sheet, SheetCell } from '../../export/sheet';
import { safeFetch, SourceError } from '../fetch';
import { openSecret, sealSecret } from '../secret';
import { isShopDomain, refreshTokens, type ShopifyTokens } from './oauth';

/**
 * What a connected store holds, as one workbook with Products, Customers and Orders tabs (one row
 * per item sold). It goes through the same import as an uploaded export: the first one is
 * reviewed, later ones are recognised by their headers and update by themselves (ADR-058/059).
 * Orders are fetched from a day before the last check, the first time for the last year; the
 * merge keeps older orders, so nothing is lost by not fetching them again.
 */

type Connection = typeof connection.$inferSelect;
const log = () => getLogger('shopify');

export const FIRST_ORDERS_DAYS = 365;
export const MAX_ORDERS = 20_000;
const MAX_PAGES = 400;

/** A usable access token, refreshed (and stored first) when it is about to expire. */
export async function accessTokenFor(c: Connection, now = new Date()): Promise<string> {
  if (!c.secret)
    throw new SourceError(
      'This store isn’t connected any more. Please connect it again.',
      'needs_attention',
    );
  let tokens = openSecret<ShopifyTokens>(c.secret);
  const soon = now.getTime() + 5 * 60_000;
  if (tokens.expiresAt && Date.parse(tokens.expiresAt) <= soon) {
    if (!tokens.refreshToken)
      throw new SourceError(
        'Shopify no longer lets us in. Please connect your store again.',
        'needs_attention',
      );
    tokens = await refreshTokens(c.externalId, tokens.refreshToken, now);
    // The old pair is now dead: keep the new one before anything else can fail.
    await getAppDb()
      .update(connection)
      .set({ secret: sealSecret(tokens), updatedAt: new Date() })
      .where(eq(connection.id, c.id));
  }
  return tokens.accessToken;
}

interface GraphqlResult<T> {
  data?: T;
  errors?: { message?: string; extensions?: { code?: string } }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One Admin GraphQL call, waiting out Shopify's rate limit (a few tries). */
export async function shopifyGraphql<T>(
  shop: string,
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  if (!isShopDomain(shop))
    throw new SourceError('That isn’t a Shopify store address.', 'needs_attention');
  const url = `https://${shop}/admin/api/${getEnv().SHOPIFY_API_VERSION}/graphql.json`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await safeFetch(url, {
      allowHost: (h) => h === shop,
      maxBytes: 20 * 1024 * 1024,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-shopify-access-token': token,
      },
      body: JSON.stringify({ query, variables }),
      maxRedirects: 0,
      timeoutMs: 30_000,
    });
    if (res.status === 401 || res.status === 403)
      throw new SourceError(
        'Shopify no longer lets us in. Please connect your store again.',
        'needs_attention',
      );
    if (res.status === 402 || res.status === 423)
      throw new SourceError(
        'This Shopify store is paused or locked, so we can’t read it.',
        'needs_attention',
      );
    if (res.status === 429 || res.status >= 500) {
      await sleep(1_000 * 2 ** attempt);
      continue;
    }
    if (res.status !== 200)
      throw new SourceError('Shopify didn’t answer just now. We’ll try again later.');
    const body = JSON.parse(new TextDecoder().decode(res.bytes)) as GraphqlResult<T>;
    if (body.errors?.some((e) => e.extensions?.code === 'THROTTLED')) {
      await sleep(1_000 * 2 ** attempt);
      continue;
    }
    if (body.errors?.some((e) => e.extensions?.code === 'ACCESS_DENIED'))
      throw new SourceError(
        'Shopify didn’t let us read everything we need. Please connect your store again and allow access.',
        'needs_attention',
      );
    if (body.errors?.length || !body.data) {
      log().warn({ errors: body.errors?.slice(0, 3) }, 'shopify query failed');
      throw new SourceError('Shopify didn’t answer just now. We’ll try again later.');
    }
    return body.data;
  }
  throw new SourceError('Shopify is busy just now. We’ll try again later.');
}

interface Page<N> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: N[];
}

async function* pages<N>(run: (cursor: string | null) => Promise<Page<N>>): AsyncGenerator<N[]> {
  let cursor: string | null = null;
  for (let n = 0; n < MAX_PAGES; n += 1) {
    const page = await run(cursor);
    yield page.nodes;
    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) return;
    cursor = page.pageInfo.endCursor;
  }
}

const money = (v: { amount?: unknown } | null | undefined): string | null =>
  typeof v?.amount === 'string' && /^-?\d+(\.\d+)?$/.test(v.amount) ? v.amount : null;
const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

// --- Queries (Admin GraphQL, versioned by SHOPIFY_API_VERSION) ------------------------------------

export const SHOP_QUERY = `query { shop { name currencyCode } }`;

export const PRODUCTS_QUERY = `query Products($cursor: String) {
  products(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      title vendor productType status
      variants(first: 100) {
        nodes { title sku price inventoryQuantity inventoryItem { unitCost { amount } } }
      }
    }
  }
}`;

export const CUSTOMERS_QUERY = `query Customers($cursor: String) {
  customers(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { displayName email phone createdAt }
  }
}`;

export const ORDERS_QUERY = `query Orders($cursor: String, $query: String) {
  orders(first: 50, after: $cursor, query: $query, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      name createdAt cancelledAt displayFinancialStatus sourceName
      customer { displayName email }
      lineItems(first: 100) {
        nodes {
          sku name quantity
          originalUnitPriceSet { shopMoney { amount } }
          discountedTotalSet { shopMoney { amount } }
        }
      }
    }
  }
}`;

interface ProductNode {
  title: string;
  vendor?: string | null;
  productType?: string | null;
  status?: string | null;
  variants: {
    nodes: {
      title?: string | null;
      sku?: string | null;
      price?: string | null;
      inventoryQuantity?: number | null;
      inventoryItem?: { unitCost?: { amount?: string } | null } | null;
    }[];
  };
}

interface CustomerNode {
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  createdAt?: string | null;
}

interface OrderNode {
  name: string;
  createdAt: string;
  cancelledAt?: string | null;
  displayFinancialStatus?: string | null;
  sourceName?: string | null;
  customer?: { displayName?: string | null; email?: string | null } | null;
  lineItems: {
    nodes: {
      sku?: string | null;
      name?: string | null;
      quantity?: number | null;
      originalUnitPriceSet?: { shopMoney?: { amount?: string } | null } | null;
      discountedTotalSet?: { shopMoney?: { amount?: string } | null } | null;
    }[];
  };
}

/** "2026-10-13T09:30:00Z" → "2026-10-13 09:30:00" (UTC; the header says so). */
const utc = (iso: string | null | undefined): string | null =>
  iso && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) ? iso.slice(0, 19) : null;

function status(o: OrderNode): string {
  if (o.cancelledAt) return 'cancelled';
  const s = (o.displayFinancialStatus ?? '').toLowerCase();
  if (s === 'refunded') return 'refunded';
  if (s === 'partially_refunded') return 'partially refunded';
  if (s === 'pending' || s === 'authorized') return 'pending';
  return 'completed';
}

export interface StoreSnapshot {
  name: string;
  currency: string | null;
  sheets: Sheet[];
  ordersFrom: string;
  orders: number;
  truncated: boolean;
}

/** Reads the store into sheets. `since`: orders changed since then (ISO); null for the first time. */
export async function readStore(
  shop: string,
  token: string,
  since: string | null,
  now = new Date(),
): Promise<StoreSnapshot> {
  const info = await shopifyGraphql<{ shop: { name: string; currencyCode?: string } }>(
    shop,
    token,
    SHOP_QUERY,
  );

  const products: SheetCell[][] = [];
  for await (const nodes of pages((cursor) =>
    shopifyGraphql<{ products: Page<ProductNode> }>(shop, token, PRODUCTS_QUERY, { cursor }).then(
      (d) => d.products,
    ),
  ))
    for (const p of nodes)
      for (const v of p.variants.nodes) {
        const variant = text(v.title);
        products.push([
          variant && variant !== 'Default Title' ? `${p.title} - ${variant}` : p.title,
          text(v.sku),
          text(p.productType),
          text(p.vendor),
          money({ amount: v.price ?? undefined }),
          money(v.inventoryItem?.unitCost),
          typeof v.inventoryQuantity === 'number' ? v.inventoryQuantity : null,
          (p.status ?? '').toLowerCase() === 'active' ? 'active' : 'inactive',
        ]);
      }

  const customers: SheetCell[][] = [];
  for await (const nodes of pages((cursor) =>
    shopifyGraphql<{ customers: Page<CustomerNode> }>(shop, token, CUSTOMERS_QUERY, {
      cursor,
    }).then((d) => d.customers),
  ))
    for (const c of nodes)
      customers.push([
        text(c.displayName),
        text(c.email),
        text(c.phone),
        utc(c.createdAt)?.slice(0, 10) ?? null,
      ]);

  // Orders changed since a day before the last check (or the last year), newest kept if capped.
  const from = since
    ? new Date(Date.parse(since) - 24 * 3600_000)
    : new Date(now.getTime() - FIRST_ORDERS_DAYS * 24 * 3600_000);
  const ordersFrom = from.toISOString();
  const orders: SheetCell[][] = [];
  let count = 0;
  let truncated = false;
  for await (const nodes of pages((cursor) =>
    shopifyGraphql<{ orders: Page<OrderNode> }>(shop, token, ORDERS_QUERY, {
      cursor,
      query: `updated_at:>='${ordersFrom}'`,
    }).then((d) => d.orders),
  )) {
    for (const o of nodes) {
      count += 1;
      const st = status(o);
      for (const li of o.lineItems.nodes)
        orders.push([
          o.name,
          utc(o.createdAt),
          st,
          text(o.customer?.displayName),
          text(o.customer?.email),
          text(li.sku),
          text(li.name),
          typeof li.quantity === 'number' ? li.quantity : null,
          money(li.originalUnitPriceSet?.shopMoney),
          money(li.discountedTotalSet?.shopMoney),
          text(o.sourceName) === 'pos' ? 'Shopify POS' : 'Online store',
        ]);
    }
    if (count >= MAX_ORDERS) {
      truncated = true;
      break;
    }
  }

  const cur = info.shop.currencyCode ?? null;
  const m = (label: string) => (cur ? `${label} (${cur})` : label);
  return {
    name: info.shop.name,
    currency: cur,
    ordersFrom,
    orders: count,
    truncated,
    sheets: [
      {
        name: 'Products',
        columns: [
          { label: 'Product', type: 'text' },
          { label: 'SKU', type: 'text' },
          { label: 'Category', type: 'text' },
          { label: 'Supplier', type: 'text' },
          { label: m('Price'), type: 'money' },
          { label: m('Cost'), type: 'money' },
          { label: 'In stock', type: 'number' },
          { label: 'Status', type: 'text' },
        ],
        rows: products,
      },
      {
        name: 'Customers',
        columns: [
          { label: 'Customer', type: 'text' },
          { label: 'Email', type: 'text' },
          { label: 'Phone', type: 'text' },
          { label: 'Customer since', type: 'date' },
        ],
        rows: customers,
      },
      {
        name: 'Orders',
        columns: [
          { label: 'Order', type: 'text' },
          { label: 'Date (UTC)', type: 'datetime' },
          { label: 'Status', type: 'text' },
          { label: 'Customer', type: 'text' },
          { label: 'Email', type: 'text' },
          { label: 'SKU', type: 'text' },
          { label: 'Item', type: 'text' },
          { label: 'Quantity', type: 'number' },
          { label: m('Unit price'), type: 'money' },
          { label: m('Line total'), type: 'money' },
          { label: 'Channel', type: 'text' },
        ],
        rows: orders,
      },
    ],
  };
}

/** The connection's fetcher: the store as one Excel workbook, plus where orders were read from. */
export async function fetchStore(c: Connection, now = new Date()) {
  const token = await accessTokenFor(c, now);
  const since = typeof c.config.ordersCheckedAt === 'string' ? c.config.ordersCheckedAt : null;
  const store = await readStore(c.externalId, token, since, now);
  if (store.truncated)
    log().warn({ shop: c.externalId, orders: store.orders }, 'order cap reached');
  const bytes = await toXlsx(store.sheets);
  return {
    name: store.name,
    files: [
      {
        fileName: 'Shopify store.xlsx',
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        bytes,
      },
    ],
    config: { ordersCheckedAt: now.toISOString() },
  };
}
