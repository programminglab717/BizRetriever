import { createHmac } from 'node:crypto';

import { resetEnvCache } from '@bizr/platform';
import ExcelJS from 'exceljs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { toXlsx } from '../../export/write';
import { setConnectorFetch } from '../fetch';
import { openSecret, sealSecret } from '../secret';
import {
  authorizeUrl,
  exchangeCode,
  normalizeShop,
  refreshTokens,
  shopifyEnabled,
  verifyCallback,
  verifyWebhook,
} from './oauth';
import { readStore, shopifyGraphql } from './store';

const SECRET = 'shpss_test_secret_0123456789';
const saved = { ...process.env };

beforeAll(() => {
  process.env.SHOPIFY_CLIENT_ID = 'test-client-id';
  process.env.SHOPIFY_CLIENT_SECRET = SECRET;
  process.env.CONNECTOR_SECRET = 'test-connector-secret-0123456789abcdef';
  process.env.APP_URL = 'https://app.example.test';
  resetEnvCache();
});
afterAll(() => {
  process.env = saved;
  resetEnvCache();
});
afterEach(() => setConnectorFetch(null));

describe('shop addresses', () => {
  it('accepts what owners type, and only myshopify.com stores', () => {
    for (const input of [
      'fernwood',
      'Fernwood.myshopify.com',
      'https://fernwood.myshopify.com/admin/products',
      ' fernwood.myshopify.com ',
    ])
      expect(normalizeShop(input)).toBe('fernwood.myshopify.com');
    for (const input of [
      '',
      'fernwood.com',
      'https://evil.example/?x=fernwood.myshopify.com',
      'fernwood.myshopify.com.evil.example',
      'admin.shopify.com',
      '-bad.myshopify.com',
      'a b.myshopify.com',
    ])
      expect(normalizeShop(input)).toBeNull();
  });

  it('is on only with app keys and the connector secret', () => {
    expect(shopifyEnabled()).toBe(true);
    const url = new URL(authorizeUrl('fernwood.myshopify.com', 'st4te'));
    expect(url.origin).toBe('https://fernwood.myshopify.com');
    expect(url.pathname).toBe('/admin/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'test-client-id',
      scope: 'read_products,read_inventory,read_orders,read_customers',
      redirect_uri: 'https://app.example.test/api/connect/shopify/callback',
      state: 'st4te',
    });
  });
});

describe('signatures', () => {
  const sign = (params: Record<string, string>) => {
    const message = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    return createHmac('sha256', SECRET).update(message).digest('hex');
  };

  it('checks the callback’s HMAC over the sorted parameters', () => {
    const params = {
      code: 'abc',
      shop: 'fernwood.myshopify.com',
      state: 'st4te',
      timestamp: '1793000000',
      host: 'ZmVybndvb2QubXlzaG9waWZ5LmNvbS9hZG1pbg',
    };
    const good = new URLSearchParams({ ...params, hmac: sign(params) });
    expect(verifyCallback(good)).toBe(true);
    const tampered = new URLSearchParams({
      ...params,
      shop: 'other.myshopify.com',
      hmac: sign(params),
    });
    expect(verifyCallback(tampered)).toBe(false);
    expect(verifyCallback(new URLSearchParams(params))).toBe(false);
  });

  it('checks webhooks’ base64 HMAC of the raw body', () => {
    const body = '{"id":1}';
    const header = createHmac('sha256', SECRET).update(body).digest('base64');
    expect(verifyWebhook(body, header)).toBe(true);
    expect(verifyWebhook(`${body} `, header)).toBe(false);
    expect(verifyWebhook(body, null)).toBe(false);
  });

  it('seals tokens so the database never holds them in the clear', () => {
    const sealed = sealSecret({ accessToken: 'shpat_x' });
    expect(sealed).not.toContain('shpat_x');
    expect(openSecret(sealed)).toEqual({ accessToken: 'shpat_x' });
    const [v, iv, tag, body] = sealed.split('.');
    const flipped = `${v}.${iv}.${tag}.${body!.slice(0, -2)}AA`;
    expect(() => openSecret(flipped)).toThrow();
  });
});

describe('tokens', () => {
  it('asks for an expiring token and reads both lifetimes', async () => {
    let sent = '';
    setConnectorFetch(async (url, init) => {
      expect(url).toBe('https://fernwood.myshopify.com/admin/oauth/access_token');
      sent = init.body as string;
      return Response.json({
        access_token: 'shpat_1',
        scope: 'read_products',
        expires_in: 3600,
        refresh_token: 'shprt_1',
        refresh_token_expires_in: 7_776_000,
      });
    });
    const now = new Date('2026-10-26T12:00:00Z');
    const t = await exchangeCode('fernwood.myshopify.com', 'the-code', now);
    expect(Object.fromEntries(new URLSearchParams(sent))).toEqual({
      client_id: 'test-client-id',
      client_secret: SECRET,
      code: 'the-code',
      expiring: '1',
    });
    expect(t).toEqual({
      accessToken: 'shpat_1',
      scope: 'read_products',
      expiresAt: '2026-10-26T13:00:00.000Z',
      refreshToken: 'shprt_1',
      refreshExpiresAt: '2027-01-24T12:00:00.000Z',
    });
    await refreshTokens('fernwood.myshopify.com', 'shprt_1', now);
    expect(new URLSearchParams(sent).get('grant_type')).toBe('refresh_token');
  });

  it('refuses to send credentials anywhere but the shop', async () => {
    await expect(exchangeCode('evil.example', 'x')).rejects.toThrow(/Shopify store address/);
  });
});

describe('reading a store', () => {
  const page = <N>(nodes: N[]) => ({ pageInfo: { hasNextPage: false, endCursor: null }, nodes });

  it('turns products, customers and orders into tabs, one row per item sold', async () => {
    const seen: string[] = [];
    let throttled = false;
    setConnectorFetch(async (url, init) => {
      expect(url).toBe('https://fernwood.myshopify.com/admin/api/2026-07/graphql.json');
      expect((init.headers as Record<string, string>)['x-shopify-access-token']).toBe('shpat_1');
      const { query, variables } = JSON.parse(init.body as string) as {
        query: string;
        variables: Record<string, unknown>;
      };
      seen.push(query.trim().split(/[\s({]/)[1] ?? '');
      if (query.includes('shop {'))
        return Response.json({ data: { shop: { name: 'Fernwood', currencyCode: 'USD' } } });
      if (query.includes('products(')) {
        if (!throttled) {
          throttled = true;
          return Response.json({
            errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
          });
        }
        return Response.json({
          data: {
            products: page([
              {
                title: 'Sage Stoneware Mug',
                vendor: 'Clayworks',
                productType: 'Kitchen',
                status: 'ACTIVE',
                variants: {
                  nodes: [
                    {
                      title: 'Default Title',
                      sku: 'MUG-SAGE',
                      price: '18.00',
                      inventoryQuantity: 4,
                      inventoryItem: { unitCost: { amount: '6.50' } },
                    },
                  ],
                },
              },
            ]),
          },
        });
      }
      if (query.includes('customers('))
        return Response.json({
          data: {
            customers: page([
              {
                displayName: 'Bloom & Co',
                email: 'hi@bloom.test',
                phone: null,
                createdAt: '2025-03-01T10:00:00Z',
              },
            ]),
          },
        });
      expect(variables.query).toBe("updated_at:>='2026-10-12T12:00:00.000Z'");
      return Response.json({
        data: {
          orders: page([
            {
              name: '#1043',
              createdAt: '2026-10-12T15:04:05Z',
              cancelledAt: null,
              displayFinancialStatus: 'PAID',
              sourceName: 'web',
              customer: { displayName: 'Bloom & Co', email: 'hi@bloom.test' },
              lineItems: {
                nodes: [
                  {
                    sku: 'MUG-SAGE',
                    name: 'Sage Stoneware Mug',
                    quantity: 2,
                    originalUnitPriceSet: { shopMoney: { amount: '18.00' } },
                    discountedTotalSet: { shopMoney: { amount: '32.40' } },
                  },
                  {
                    sku: null,
                    name: '=cmd|calc',
                    quantity: 1,
                    originalUnitPriceSet: { shopMoney: { amount: '1.00' } },
                    discountedTotalSet: { shopMoney: { amount: '1.00' } },
                  },
                ],
              },
            },
          ]),
        },
      });
    });
    const store = await readStore(
      'fernwood.myshopify.com',
      'shpat_1',
      '2026-10-13T12:00:00.000Z',
      new Date('2026-10-14T12:00:00Z'),
    );
    expect(store).toMatchObject({ name: 'Fernwood', currency: 'USD', orders: 1, truncated: false });
    const [products, customers, orders] = store.sheets;
    expect(products!.rows).toEqual([
      ['Sage Stoneware Mug', 'MUG-SAGE', 'Kitchen', 'Clayworks', '18.00', '6.50', 4, 'active'],
    ]);
    expect(products!.columns.map((c) => c.label)).toContain('Price (USD)');
    expect(customers!.rows).toEqual([['Bloom & Co', 'hi@bloom.test', null, '2025-03-01']]);
    expect(orders!.rows).toEqual([
      [
        '#1043',
        '2026-10-12T15:04:05',
        'completed',
        'Bloom & Co',
        'hi@bloom.test',
        'MUG-SAGE',
        'Sage Stoneware Mug',
        2,
        '18.00',
        '32.40',
        'Online store',
      ],
      [
        '#1043',
        '2026-10-12T15:04:05',
        'completed',
        'Bloom & Co',
        'hi@bloom.test',
        null,
        '=cmd|calc',
        1,
        '1.00',
        '1.00',
        'Online store',
      ],
    ]);
    // The throttled call was waited out and retried.
    expect(seen.filter((s) => s === 'Products')).toHaveLength(2);
    // And it writes a workbook the import can read.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await toXlsx(store.sheets)).buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Products', 'Customers', 'Orders']);
  }, 20_000);

  it('says plainly when Shopify no longer lets us in', async () => {
    setConnectorFetch(async () => new Response('Unauthorized', { status: 401 }));
    await expect(
      shopifyGraphql('fernwood.myshopify.com', 'old', '{ shop { name } }'),
    ).rejects.toThrow(/connect your store again/);
  });
});
