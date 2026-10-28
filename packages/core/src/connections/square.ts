import { getEnv } from '@bizr/platform';

import { SourceError } from './fetch';
import { apiJson, tokenRequest, tokensOnly } from './oauth/http';
import type { Connection, OAuthProvider, OAuthTokens } from './oauth/provider';
import { callbackUrl } from './oauth/service';
import { connectorSecretsEnabled } from './secret';
import {
  fromMinor,
  shopSheets,
  textOf,
  utcStamp,
  workbookFile,
  type ShopCustomer,
  type ShopOrderLine,
  type ShopProduct,
} from './workbook';

/**
 * Square (M18, ADR-068): items with their stock, customers and completed orders from every
 * location. Code-flow tokens: access tokens last 30 days, the refresh token doesn't expire and
 * comes back unchanged. Money is in the currency's smallest unit (cents), turned into decimals
 * here by the currency's own number of places.
 */

export const SQUARE_SCOPES = [
  'MERCHANT_PROFILE_READ',
  'ORDERS_READ',
  'ITEMS_READ',
  'CUSTOMERS_READ',
  'INVENTORY_READ',
];
export const SQUARE_FIRST_DAYS = 365;
const MAX_PAGES = 200;

const host = () =>
  getEnv().SQUARE_ENVIRONMENT === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';

function app() {
  const env = getEnv();
  if (!env.SQUARE_APPLICATION_ID || !env.SQUARE_APPLICATION_SECRET)
    throw new Error('Square app keys are not set');
  return { id: env.SQUARE_APPLICATION_ID, secret: env.SQUARE_APPLICATION_SECRET };
}

const sq = <T>(path: string, token: string, body?: unknown) =>
  apiJson<T>('Square', `${host()}${path}`, {
    token,
    ...(body !== undefined ? { method: 'POST' as const, body } : {}),
    headers: { 'square-version': getEnv().SQUARE_API_VERSION },
  });

interface Money {
  amount?: number;
  currency?: string;
}
interface CatalogObject {
  type?: string;
  id?: string;
  is_deleted?: boolean;
  item_data?: {
    name?: string;
    is_archived?: boolean;
    categories?: { id?: string }[];
    category_id?: string;
    variations?: {
      id?: string;
      item_variation_data?: { name?: string; sku?: string; price_money?: Money };
    }[];
  };
  category_data?: { name?: string };
}
interface SquareOrder {
  id?: string;
  created_at?: string;
  closed_at?: string;
  state?: string;
  customer_id?: string;
  source?: { name?: string };
  line_items?: {
    name?: string;
    variation_name?: string;
    quantity?: string;
    catalog_object_id?: string;
    base_price_money?: Money;
    total_money?: Money;
  }[];
  returns?: unknown[];
}
interface SquareCustomer {
  id?: string;
  given_name?: string;
  family_name?: string;
  company_name?: string;
  email_address?: string;
  phone_number?: string;
  created_at?: string;
}

/** Decimal places of a currency (JPY 0, USD 2). */
export function currencyPlaces(currency: string | null | undefined): number {
  try {
    return (
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency: currency ?? 'USD',
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

const money = (m: Money | undefined) =>
  m && typeof m.amount === 'number' ? fromMinor(m.amount, currencyPlaces(m.currency)) : null;

export const square: OAuthProvider = {
  kind: 'square',
  label: 'Square',
  enabled() {
    const env = getEnv();
    return Boolean(
      env.SQUARE_APPLICATION_ID && env.SQUARE_APPLICATION_SECRET && connectorSecretsEnabled(),
    );
  },
  authorizeUrl(state) {
    const url = new URL(`${host()}/oauth2/authorize`);
    url.searchParams.set('client_id', app().id);
    url.searchParams.set('scope', SQUARE_SCOPES.join(' '));
    url.searchParams.set('session', 'false');
    url.searchParams.set('redirect_uri', callbackUrl('square'));
    url.searchParams.set('state', state);
    return url.toString();
  },
  async connect(params, now) {
    const a = app();
    const tokens = await tokenRequest({
      label: 'Square',
      url: `${host()}/oauth2/token`,
      json: {
        client_id: a.id,
        client_secret: a.secret,
        code: params.get('code') ?? '',
        redirect_uri: callbackUrl('square'),
        grant_type: 'authorization_code',
      },
      now,
    });
    const me = await sq<{ merchant?: { id?: string; business_name?: string; currency?: string } }>(
      '/v2/merchants/me',
      tokens.accessToken,
    );
    const id = textOf(me.merchant?.id) ?? textOf(tokens.raw.merchant_id);
    if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id))
      throw new SourceError('Square didn’t say which business to read. Please try again.');
    return {
      tokens: tokensOnly(tokens),
      account: {
        externalId: id,
        name: textOf(me.merchant?.business_name) ?? 'Square',
        config: { currency: textOf(me.merchant?.currency) },
      },
    };
  },
  async refresh(tokens, now): Promise<OAuthTokens> {
    const a = app();
    const fresh = await tokenRequest({
      label: 'Square',
      url: `${host()}/oauth2/token`,
      json: {
        client_id: a.id,
        client_secret: a.secret,
        refresh_token: tokens.refreshToken ?? '',
        grant_type: 'refresh_token',
      },
      now,
    });
    return tokensOnly({ ...fresh, refreshToken: fresh.refreshToken ?? tokens.refreshToken });
  },
  read: (c, token, now) => readSquare(c, token, now),
  link: () => 'https://app.squareup.com/dashboard/',
};

async function* cursorPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; cursor?: string }>,
) {
  let cursor: string | undefined;
  for (let n = 0; n < MAX_PAGES; n += 1) {
    const page = await fetchPage(cursor);
    yield page.items;
    if (!page.cursor) return;
    cursor = page.cursor;
  }
}

export async function readSquare(c: Connection, token: string, now = new Date()) {
  // Catalog: items with their variations, and category names.
  const objects: CatalogObject[] = [];
  for await (const items of cursorPages((cursor) =>
    sq<{ objects?: CatalogObject[]; cursor?: string }>(
      `/v2/catalog/list?types=ITEM,CATEGORY${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      token,
    ).then((r) => ({ items: r.objects ?? [], ...(r.cursor ? { cursor: r.cursor } : {}) })),
  ))
    objects.push(...items);
  const categories = new Map(
    objects.filter((o) => o.type === 'CATEGORY').map((o) => [o.id, textOf(o.category_data?.name)]),
  );
  // Stock on hand per variation, added up over locations.
  const stock = new Map<string, number>();
  for await (const counts of cursorPages((cursor) =>
    sq<{
      counts?: { catalog_object_id?: string; state?: string; quantity?: string }[];
      cursor?: string;
    }>('/v2/inventory/counts/batch-retrieve', token, {
      states: ['IN_STOCK'],
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    }).then((r) => ({ items: r.counts ?? [], ...(r.cursor ? { cursor: r.cursor } : {}) })),
  ))
    for (const n of counts)
      if (n.catalog_object_id && n.state === 'IN_STOCK' && Number.isFinite(Number(n.quantity)))
        stock.set(n.catalog_object_id, (stock.get(n.catalog_object_id) ?? 0) + Number(n.quantity));

  const variations = new Map<string, { name: string; sku: string | null }>();
  const products: ShopProduct[] = [];
  for (const o of objects) {
    if (o.type !== 'ITEM' || o.is_deleted || !o.item_data) continue;
    const item = o.item_data;
    const category = categories.get(item.categories?.[0]?.id ?? item.category_id ?? '') ?? null;
    for (const v of item.variations ?? []) {
      const d = v.item_variation_data ?? {};
      const vname = textOf(d.name);
      const name =
        vname && vname !== 'Regular'
          ? `${textOf(item.name) ?? ''} - ${vname}`
          : (textOf(item.name) ?? '');
      if (v.id) variations.set(v.id, { name, sku: textOf(d.sku) });
      products.push({
        name,
        sku: textOf(d.sku),
        category,
        supplier: null,
        price: money(d.price_money),
        cost: null,
        inStock: v.id && stock.has(v.id) ? stock.get(v.id)! : null,
        active: !item.is_archived,
      });
    }
  }

  const people = new Map<string, string | null>();
  const customers: ShopCustomer[] = [];
  for await (const page of cursorPages((cursor) =>
    sq<{ customers?: SquareCustomer[]; cursor?: string }>(
      `/v2/customers?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      token,
    ).then((r) => ({ items: r.customers ?? [], ...(r.cursor ? { cursor: r.cursor } : {}) })),
  ))
    for (const p of page) {
      const name =
        [textOf(p.given_name), textOf(p.family_name)].filter(Boolean).join(' ') ||
        textOf(p.company_name);
      if (p.id) people.set(p.id, name);
      customers.push({
        name,
        email: textOf(p.email_address),
        phone: textOf(p.phone_number),
        since: utcStamp(p.created_at)?.slice(0, 10) ?? null,
      });
    }

  // Completed orders updated since a day before the last check (the last year the first time),
  // ten locations a search, as Square allows.
  const locations = await sq<{ locations?: { id?: string }[] }>('/v2/locations', token);
  const ids = (locations.locations ?? []).map((l) => l.id).filter((x): x is string => Boolean(x));
  const since = typeof c.config.ordersCheckedAt === 'string' ? c.config.ordersCheckedAt : null;
  const from = since
    ? new Date(Date.parse(since) - 86_400_000)
    : new Date(now.getTime() - SQUARE_FIRST_DAYS * 86_400_000);
  const orders: ShopOrderLine[] = [];
  let currency = textOf(c.config.currency);
  for (let i = 0; i < ids.length; i += 10) {
    const query = {
      filter: {
        date_time_filter: { updated_at: { start_at: from.toISOString() } },
        state_filter: { states: ['COMPLETED'] },
      },
      // The sort must be on the same date the filter uses.
      sort: { sort_field: 'UPDATED_AT', sort_order: 'ASC' },
    };
    for await (const page of cursorPages((cursor) =>
      sq<{ orders?: SquareOrder[]; cursor?: string }>('/v2/orders/search', token, {
        location_ids: ids.slice(i, i + 10),
        query,
        limit: 500,
        ...(cursor ? { cursor } : {}),
      }).then((r) => ({ items: r.orders ?? [], ...(r.cursor ? { cursor: r.cursor } : {}) })),
    ))
      for (const o of page)
        for (const li of o.line_items ?? []) {
          currency ??= textOf(li.total_money?.currency);
          const v = li.catalog_object_id ? variations.get(li.catalog_object_id) : undefined;
          const qty = Number(li.quantity);
          orders.push({
            order: textOf(o.id) ?? '',
            date: utcStamp(o.closed_at ?? o.created_at),
            status: 'completed',
            customer: o.customer_id ? (people.get(o.customer_id) ?? null) : null,
            email: null,
            sku: v?.sku ?? null,
            item:
              v?.name ??
              ([textOf(li.name), textOf(li.variation_name)].filter(Boolean).join(' - ') || null),
            quantity: Number.isFinite(qty) ? qty : null,
            unitPrice: money(li.base_price_money),
            lineTotal: money(li.total_money),
            channel: /online/i.test(o.source?.name ?? '') ? 'Online store' : 'In store',
          });
        }
  }
  return {
    name: c.name,
    files: [
      await workbookFile('Square.xlsx', shopSheets({ products, customers, orders }, currency)),
    ],
    config: { ordersCheckedAt: now.toISOString() },
  };
}
