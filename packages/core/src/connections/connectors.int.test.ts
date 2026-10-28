import { closePools, connection, getAppDb } from '@bizr/db';
import { resetEnvCache } from '@bizr/platform';
import { databaseAvailable } from '@bizr/platform/testing';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { setConnectorFetch } from './fetch';
import type { OAuthProvider } from './oauth/provider';
import { oauthProviders } from './oauth/registry';
import { beginConnect, completeConnect } from './oauth/service';
import { openSecret } from './secret';
import { syncConnection } from './service';
import { connectorBench, type ConnectorBench } from './testing/import';
import { beginWooConnect, receiveWooKeys } from './woocommerce';

/**
 * M18 acceptance (ADR-068): QuickBooks, Xero, Square and WooCommerce, played back from recorded
 * answers in each API's documented shapes, never called. Each is connected through its own
 * sign-in, read into a workbook, brought in without AI and reviewed like an upload; a later check
 * refreshes the token and keeps the new one.
 */
const hasDb = await databaseAvailable();
const saved = { ...process.env };

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response> | undefined;
let handlers: Handler[] = [];
const calls: { host: string; path: string; auth: string }[] = [];
const json = (body: unknown, status = 200) => Response.json(body, { status });
const bodyOf = (init: RequestInit) => (typeof init.body === 'string' ? init.body : '');

beforeAll(() => {
  Object.assign(process.env, {
    CONNECTOR_SECRET: 'int-connector-secret-0123456789abcdef',
    APP_URL: 'https://app.example.test',
    QUICKBOOKS_CLIENT_ID: 'qb-id',
    QUICKBOOKS_CLIENT_SECRET: 'qb-secret',
    XERO_CLIENT_ID: 'xero-id',
    XERO_CLIENT_SECRET: 'xero-secret',
    SQUARE_APPLICATION_ID: 'sq0idp-test',
    SQUARE_APPLICATION_SECRET: 'sq0csp-test',
  });
  resetEnvCache();
  setConnectorFetch(async (u, init) => {
    const url = new URL(u);
    calls.push({
      host: url.host,
      path: url.pathname,
      auth: String((init.headers as Record<string, string>).authorization ?? ''),
    });
    for (const h of handlers) {
      const r = await h(url, init);
      if (r) return r;
    }
    return json({ error: `no recording for ${url.href}` }, 404);
  });
});
afterEach(() => {
  handlers = [];
});
afterAll(async () => {
  setConnectorFetch(null);
  process.env = saved;
  resetEnvCache();
  await closePools();
});

/** Through the provider's sign-in, then the first check's import to the end. */
async function connectAndImport(
  bench: ConnectorBench,
  provider: OAuthProvider,
  extra: Record<string, string> = {},
) {
  const { url, cookie } = beginConnect(provider, bench.member, bench.owner);
  const state = new URL(url).searchParams.get('state')!;
  const done = await completeConnect(provider, {
    params: new URLSearchParams({ code: 'the-code', state, ...extra }),
    cookie,
    sessionUserId: bench.owner,
    queue: bench.queue,
  });
  await bench.queue.drain({ budgetMs: 60_000 });
  const [c] = await getAppDb()
    .select()
    .from(connection)
    .where(eq(connection.id, done.connectionId));
  expect(c!.lastError).toBeNull();
  const kinds = await bench.importAll(c!.lastRunId!);
  return { connectionId: done.connectionId, kinds, connection: c! };
}

describe.skipIf(!hasDb)('QuickBooks (integration)', () => {
  let b: ConnectorBench;
  let refreshes = 0;
  beforeAll(async () => {
    b = await connectorBench('QuickBooks Test', 'wholesale');
  }, 120_000);
  afterAll(() => b?.dispose());

  const qbo: Handler = (url, init) => {
    if (url.host === 'oauth.platform.intuit.com') {
      expect(init.headers).toMatchObject({
        authorization: `Basic ${Buffer.from('qb-id:qb-secret').toString('base64')}`,
      });
      const form = new URLSearchParams(bodyOf(init));
      if (form.get('grant_type') === 'refresh_token') {
        expect(form.get('refresh_token')).toBe(`qb-refresh-${refreshes}`);
        refreshes += 1;
      } else expect(form.get('code')).toBe('the-code');
      return json({
        access_token: `qb-access-${refreshes}`,
        refresh_token: `qb-refresh-${refreshes}`,
        token_type: 'bearer',
        expires_in: 3600,
        x_refresh_token_expires_in: 8_726_400,
      });
    }
    if (url.host !== 'quickbooks.api.intuit.com') return undefined;
    expect(url.searchParams.get('minorversion')).toBe('75');
    if (url.pathname.endsWith('/companyinfo/9130350000000001'))
      return json({ CompanyInfo: { CompanyName: 'Harbour & Pine Supply' } });
    const q = url.searchParams.get('query') ?? '';
    const respond = (entity: string, rows: unknown[]) =>
      json({
        QueryResponse: { [entity]: rows, startPosition: 1, maxResults: rows.length },
        time: '2026-10-28T09:00:00Z',
      });
    if (q.startsWith('SELECT * FROM Item'))
      return respond('Item', [
        {
          Id: '1',
          Name: 'Paper Cups 12oz',
          Sku: 'CUP-12',
          Type: 'Inventory',
          UnitPrice: 4.5,
          PurchaseCost: 2,
          TrackQtyOnHand: true,
          QtyOnHand: 300,
        },
        {
          Id: '2',
          Name: 'Oat Milk 1L',
          Sku: 'OAT-1',
          Type: 'Inventory',
          UnitPrice: 2.1,
          PurchaseCost: 1.2,
          TrackQtyOnHand: true,
          QtyOnHand: 40,
        },
        { Id: '3', Name: 'Hours', Type: 'Category' },
      ]);
    if (q.startsWith('SELECT * FROM Customer'))
      return respond('Customer', [
        {
          DisplayName: 'Corner Bloom Café',
          PrimaryEmailAddr: { Address: 'orders@cornerbloom.test' },
          BillAddr: { City: 'Portland' },
          SalesTermRef: { value: '3', name: 'Net 30' },
          Active: true,
        },
        {
          DisplayName: 'Hilltop Hotel',
          PrimaryEmailAddr: { Address: 'buying@hilltop.test' },
          BillAddr: { City: 'Bangor' },
          Active: true,
        },
      ]);
    if (q.startsWith('SELECT * FROM Invoice WHERE Id IN')) return respond('Invoice', []);
    if (q.startsWith('SELECT * FROM Invoice'))
      return respond('Invoice', [
        {
          Id: '101',
          DocNumber: '1001',
          TxnDate: '2026-10-01',
          DueDate: '2026-10-31',
          Balance: 57.6,
          TotalAmt: 57.6,
          CustomerRef: { value: '1', name: 'Corner Bloom Café' },
          CurrencyRef: { value: 'USD' },
          Line: [
            {
              Amount: 45,
              DetailType: 'SalesItemLineDetail',
              SalesItemLineDetail: {
                ItemRef: { value: '1', name: 'Paper Cups 12oz' },
                Qty: 10,
                UnitPrice: 4.5,
              },
            },
            {
              Amount: 12.6,
              DetailType: 'SalesItemLineDetail',
              SalesItemLineDetail: {
                ItemRef: { value: '2', name: 'Oat Milk 1L' },
                Qty: 6,
                UnitPrice: 2.1,
              },
            },
            { Amount: 57.6, DetailType: 'SubTotalLineDetail', SubTotalLineDetail: {} },
          ],
        },
        {
          Id: '102',
          DocNumber: '1002',
          TxnDate: '2026-10-03',
          DueDate: '2026-11-02',
          Balance: 0,
          TotalAmt: 90,
          CustomerRef: { value: '2', name: 'Hilltop Hotel' },
          CurrencyRef: { value: 'USD' },
          Line: [
            {
              Amount: 90,
              DetailType: 'SalesItemLineDetail',
              SalesItemLineDetail: { ItemRef: { value: '1' }, Qty: 20, UnitPrice: 4.5 },
            },
          ],
        },
      ]);
    if (q.startsWith('SELECT * FROM Payment'))
      return respond('Payment', [
        {
          TxnDate: '2026-10-10',
          TotalAmt: 90,
          PaymentRefNum: 'P-1',
          CustomerRef: { value: '2', name: 'Hilltop Hotel' },
          Line: [{ Amount: 90, LinkedTxn: [{ TxnId: '102', TxnType: 'Invoice' }] }],
        },
      ]);
    return undefined;
  };

  it('refuses a callback that isn’t for this person and this request', async () => {
    const { cookie } = beginConnect(oauthProviders.quickbooks, b.member, b.owner);
    for (const a of [
      {
        params: new URLSearchParams({ code: 'c', state: 'forged', realmId: '1' }),
        cookie,
        sessionUserId: b.owner,
      },
      {
        params: new URLSearchParams({ code: 'c', state: 'x', realmId: '1' }),
        cookie: undefined,
        sessionUserId: b.owner,
      },
    ])
      await expect(
        completeConnect(oauthProviders.quickbooks, { ...a, queue: b.queue }),
      ).rejects.toThrow(/didn’t work/);
    // Someone else signed in, with the right state.
    const start = beginConnect(oauthProviders.quickbooks, b.member, b.owner);
    const state = new URL(start.url).searchParams.get('state')!;
    await expect(
      completeConnect(oauthProviders.quickbooks, {
        params: new URLSearchParams({ code: 'c', state, realmId: '1' }),
        cookie: start.cookie,
        sessionUserId: crypto.randomUUID(),
        queue: b.queue,
      }),
    ).rejects.toThrow(/didn’t work/);
    // A cookie made for another provider.
    const other = beginConnect(oauthProviders.xero, b.member, b.owner);
    await expect(
      completeConnect(oauthProviders.quickbooks, {
        params: new URLSearchParams({
          code: 'c',
          state: new URL(other.url).searchParams.get('state')!,
          realmId: '1',
        }),
        cookie: other.cookie,
        sessionUserId: b.owner,
        queue: b.queue,
      }),
    ).rejects.toThrow(/didn’t work/);
    // The owner said no.
    const said = beginConnect(oauthProviders.quickbooks, b.member, b.owner);
    await expect(
      completeConnect(oauthProviders.quickbooks, {
        params: new URLSearchParams({
          error: 'access_denied',
          state: new URL(said.url).searchParams.get('state')!,
        }),
        cookie: said.cookie,
        sessionUserId: b.owner,
        queue: b.queue,
      }),
    ).rejects.toThrow(/wasn’t connected/);
  });

  it('connects a company and brings invoices, customers, payments and products in without AI', async () => {
    handlers = [qbo];
    const r = await connectAndImport(b, oauthProviders.quickbooks, { realmId: '9130350000000001' });
    expect(r.connection).toMatchObject({
      kind: 'quickbooks',
      externalId: '9130350000000001',
      name: 'Harbour & Pine Supply',
    });
    expect(openSecret<{ accessToken: string }>(r.connection.secret!).accessToken).toBe(
      'qb-access-0',
    );
    expect(r.kinds).toEqual(
      expect.arrayContaining(['product', 'customer', 'sale', 'sale_line', 'payment']),
    );
    expect(await b.count('SELECT count(*) AS n FROM sales')).toBe(2);
    expect(await b.count('SELECT count(*) AS n FROM sale_lines')).toBe(3);
    expect(await b.count('SELECT count(*) AS n FROM payments')).toBe(1);
    expect(await b.count("SELECT count(*) AS n FROM sales WHERE payment_status = 'paid'")).toBe(1);

    // An hour on, the token is refreshed (it rotates) and the new pair kept.
    const later = new Date(Date.now() + 2 * 3600_000);
    // Nothing new in the company: no import, but the refreshed tokens are kept.
    expect(await syncConnection(r.connectionId, b.enqueue, later)).toBe('unchanged');
    const [c] = await getAppDb().select().from(connection).where(eq(connection.id, r.connectionId));
    expect(openSecret<{ refreshToken: string }>(c!.secret!).refreshToken).toBe('qb-refresh-1');
    expect(calls.filter((x) => x.host === 'quickbooks.api.intuit.com').at(-1)!.auth).toBe(
      'Bearer qb-access-1',
    );
  }, 240_000);
});

describe.skipIf(!hasDb)('Xero (integration)', () => {
  let b: ConnectorBench;
  beforeAll(async () => {
    b = await connectorBench('Xero Test', 'wholesale');
  }, 120_000);
  afterAll(() => b?.dispose());
  const tenant = '45e4708e-d862-4111-ab3a-dd8cd03913e1';

  it('connects the organisation just approved and brings its sales in without AI', async () => {
    handlers = [
      (url, init) => {
        if (url.host === 'identity.xero.com')
          return json({
            access_token: 'xero-access',
            refresh_token: 'xero-refresh',
            expires_in: 1800,
            token_type: 'Bearer',
          });
        if (url.host !== 'api.xero.com') return undefined;
        if (url.pathname === '/connections')
          return json([
            {
              id: 'a',
              tenantId: '11111111-1111-4111-8111-111111111111',
              tenantType: 'ORGANISATION',
              tenantName: 'Older Org',
              createdDateUtc: '2025-01-01T00:00:00',
            },
            {
              id: 'b',
              tenantId: tenant,
              tenantType: 'ORGANISATION',
              tenantName: 'Driftwood Trading',
              createdDateUtc: '2026-10-28T08:59:00',
            },
          ]);
        expect((init.headers as Record<string, string>)['xero-tenant-id']).toBe(tenant);
        if (url.pathname.endsWith('/Items'))
          return json({
            Items: [
              {
                Code: 'BEAN-1',
                Name: 'House Beans 1kg',
                IsTrackedAsInventory: true,
                QuantityOnHand: 25,
                PurchaseDetails: { UnitPrice: 11 },
                SalesDetails: { UnitPrice: 19.5 },
              },
            ],
          });
        if (url.pathname.endsWith('/Contacts'))
          return json({
            Contacts: [
              {
                Name: 'Seaside Bakehouse',
                EmailAddress: 'hi@seaside.test',
                IsCustomer: true,
                ContactStatus: 'ACTIVE',
                PaymentTerms: { Sales: { Day: 14, Type: 'DAYSAFTERBILLDATE' } },
              },
            ],
          });
        if (url.pathname.endsWith('/Invoices')) {
          expect(url.searchParams.get('Statuses')).toBe('AUTHORISED,PAID');
          return json({
            Invoices: [
              {
                Type: 'ACCREC',
                InvoiceNumber: 'INV-0042',
                Contact: { Name: 'Seaside Bakehouse' },
                Date: '/Date(1790812800000+0000)/',
                DateString: '2026-10-01T00:00:00',
                DueDate: '/Date(1792022400000+0000)/',
                DueDateString: '2026-10-15T00:00:00',
                Status: 'AUTHORISED',
                AmountDue: 97.5,
                Total: 97.5,
                CurrencyCode: 'USD',
                LineItems: [
                  {
                    ItemCode: 'BEAN-1',
                    Description: 'House Beans 1kg',
                    Quantity: 5,
                    UnitAmount: 19.5,
                    LineAmount: 97.5,
                  },
                ],
              },
            ],
            pagination: { page: 1, pageSize: 1000, pageCount: 1, itemCount: 1 },
          });
        }
        if (url.pathname.endsWith('/Payments')) return json({ Payments: [] });
        return undefined;
      },
    ];
    const r = await connectAndImport(b, oauthProviders.xero);
    expect(r.connection).toMatchObject({
      kind: 'xero',
      externalId: tenant,
      name: 'Driftwood Trading',
    });
    expect(r.kinds).toEqual(expect.arrayContaining(['product', 'customer', 'sale', 'sale_line']));
    expect(await b.count("SELECT count(*) AS n FROM sales WHERE order_number = 'INV-0042'")).toBe(
      1,
    );
    expect(await b.count('SELECT count(*) AS n FROM sale_lines WHERE quantity = 5')).toBe(1);
  }, 240_000);
});

describe.skipIf(!hasDb)('Square (integration)', () => {
  let b: ConnectorBench;
  beforeAll(async () => {
    b = await connectorBench('Square Test', 'retail');
  }, 120_000);
  afterAll(() => b?.dispose());

  it('connects a seller and brings items, stock, customers and orders in, money from cents', async () => {
    const searches: unknown[] = [];
    handlers = [
      (url, init) => {
        if (url.host !== 'connect.squareup.com') return undefined;
        if (url.pathname === '/oauth2/token') {
          expect(JSON.parse(bodyOf(init))).toMatchObject({
            client_id: 'sq0idp-test',
            client_secret: 'sq0csp-test',
            grant_type: 'authorization_code',
            code: 'the-code',
          });
          return json({
            access_token: 'EAAA-square',
            token_type: 'bearer',
            expires_at: '2026-11-27T09:00:00Z',
            merchant_id: 'MLM2X3',
            refresh_token: 'EQAA-refresh',
          });
        }
        expect((init.headers as Record<string, string>)['square-version']).toBe('2026-09-16');
        if (url.pathname === '/v2/merchants/me')
          return json({
            merchant: {
              id: 'MLM2X3',
              business_name: 'Fernwood Market Stall',
              currency: 'USD',
              status: 'ACTIVE',
            },
          });
        if (url.pathname === '/v2/catalog/list')
          return json({
            objects: [
              { type: 'CATEGORY', id: 'CAT1', category_data: { name: 'Mugs' } },
              {
                type: 'ITEM',
                id: 'IT1',
                item_data: {
                  name: 'Sage Stoneware Mug',
                  categories: [{ id: 'CAT1' }],
                  variations: [
                    {
                      id: 'V1',
                      item_variation_data: {
                        name: 'Regular',
                        sku: 'MUG-SAGE',
                        price_money: { amount: 1800, currency: 'USD' },
                      },
                    },
                  ],
                },
              },
              {
                type: 'ITEM',
                id: 'IT2',
                item_data: {
                  name: 'Fig Leaf Candle',
                  variations: [
                    {
                      id: 'V2',
                      item_variation_data: {
                        name: 'Large',
                        sku: 'CAN-FIG-L',
                        price_money: { amount: 2250, currency: 'USD' },
                      },
                    },
                  ],
                },
              },
            ],
          });
        if (url.pathname === '/v2/inventory/counts/batch-retrieve')
          return json({
            counts: [
              { catalog_object_id: 'V1', state: 'IN_STOCK', location_id: 'L1', quantity: '9' },
              { catalog_object_id: 'V1', state: 'IN_STOCK', location_id: 'L2', quantity: '3' },
            ],
          });
        if (url.pathname === '/v2/customers')
          return json({
            customers: [
              {
                id: 'C1',
                given_name: 'Juniper',
                family_name: 'House',
                email_address: 'hello@juniper.test',
                created_at: '2025-05-01T00:00:00Z',
              },
            ],
          });
        if (url.pathname === '/v2/locations')
          return json({ locations: [{ id: 'L1' }, { id: 'L2' }] });
        if (url.pathname === '/v2/orders/search') {
          const body = JSON.parse(bodyOf(init)) as {
            cursor?: string;
            query: { sort: { sort_field: string } };
          };
          searches.push(body);
          expect(body.query.sort.sort_field).toBe('UPDATED_AT');
          if (!body.cursor)
            return json({
              orders: [
                {
                  id: 'ORD-A',
                  created_at: '2026-10-02T15:00:00Z',
                  closed_at: '2026-10-02T15:01:00Z',
                  state: 'COMPLETED',
                  customer_id: 'C1',
                  source: { name: 'Square Point of Sale' },
                  line_items: [
                    {
                      name: 'Sage Stoneware Mug',
                      quantity: '2',
                      catalog_object_id: 'V1',
                      base_price_money: { amount: 1800, currency: 'USD' },
                      total_money: { amount: 3600, currency: 'USD' },
                    },
                  ],
                },
              ],
              cursor: 'page-2',
            });
          return json({
            orders: [
              {
                id: 'ORD-B',
                created_at: '2026-10-04T11:00:00Z',
                closed_at: '2026-10-04T11:02:00Z',
                state: 'COMPLETED',
                source: { name: 'Square Online' },
                line_items: [
                  {
                    name: 'Fig Leaf Candle',
                    variation_name: 'Large',
                    quantity: '1',
                    catalog_object_id: 'V2',
                    base_price_money: { amount: 2250, currency: 'USD' },
                    total_money: { amount: 2250, currency: 'USD' },
                  },
                ],
              },
            ],
          });
        }
        return undefined;
      },
    ];
    const r = await connectAndImport(b, oauthProviders.square);
    expect(r.connection).toMatchObject({
      kind: 'square',
      externalId: 'MLM2X3',
      name: 'Fernwood Market Stall',
    });
    expect(searches).toHaveLength(2); // followed the cursor
    expect(r.kinds).toEqual(expect.arrayContaining(['product', 'customer', 'sale', 'sale_line']));
    expect(await b.count('SELECT count(DISTINCT order_number) AS n FROM sales')).toBe(2);
    expect(await b.count('SELECT round(sum(line_total) * 100)::int AS n FROM sale_lines')).toBe(
      5850,
    );
    expect(await b.count('SELECT count(*) AS n FROM products WHERE _deleted_at IS NULL')).toBe(2);
  }, 240_000);
});

describe.skipIf(!hasDb)('WooCommerce (integration)', () => {
  let b: ConnectorBench;
  const STORE = 'https://shop.fernwood.test';
  beforeAll(async () => {
    b = await connectorBench('Woo Test', 'retail');
  }, 120_000);
  afterAll(() => b?.dispose());

  const keys = { consumer_key: `ck_${'a'.repeat(40)}`, consumer_secret: `cs_${'b'.repeat(40)}` };
  const store: Handler = (url, init) => {
    if (url.origin !== STORE) return undefined;
    if (url.pathname === '/wp-json/') return json({ name: 'Fernwood Home Online' });
    const auth = (init.headers as Record<string, string>).authorization;
    if (
      auth !==
      `Basic ${Buffer.from(`${keys.consumer_key}:${keys.consumer_secret}`).toString('base64')}`
    )
      return json({ code: 'woocommerce_rest_cannot_view' }, 401);
    const page = Number(url.searchParams.get('page') ?? 1);
    if (url.pathname.endsWith('/products'))
      return json(
        page > 1
          ? []
          : [
              {
                name: 'Sage Stoneware Mug',
                sku: 'MUG-SAGE',
                price: '18.00',
                status: 'publish',
                stock_quantity: 14,
                categories: [{ name: 'Mugs' }],
              },
              {
                name: 'Linen Napkin Set',
                sku: 'NAP-LIN',
                price: '24.00',
                status: 'publish',
                stock_quantity: 30,
                categories: [{ name: 'Table' }],
              },
              {
                id: 77,
                type: 'variable',
                name: 'Linen Apron',
                sku: 'APR',
                price: '30.00',
                status: 'publish',
                categories: [{ name: 'Table' }],
              },
            ],
      );
    if (url.pathname.endsWith('/products/77/variations'))
      return json(
        page > 1
          ? []
          : [
              {
                sku: 'APR-S',
                price: '30.00',
                stock_quantity: 4,
                status: 'publish',
                attributes: [{ option: 'Small' }],
              },
              {
                sku: 'APR-L',
                price: '32.00',
                stock_quantity: 2,
                status: 'publish',
                attributes: [{ option: 'Large' }],
              },
            ],
      );
    if (url.pathname.endsWith('/customers'))
      return json(
        page > 1
          ? []
          : [
              {
                first_name: 'Bloom',
                last_name: '& Co',
                email: 'orders@bloom.test',
                date_created_gmt: '2025-02-01T00:00:00',
              },
            ],
      );
    if (url.pathname.endsWith('/orders'))
      return json(
        url.searchParams.get('per_page') === '1' || page > 1
          ? []
          : [
              {
                id: 51,
                number: '1051',
                status: 'completed',
                currency: 'USD',
                date_created_gmt: '2026-10-01T10:00:00',
                billing: { first_name: 'Bloom', last_name: '& Co', email: 'orders@bloom.test' },
                line_items: [
                  {
                    name: 'Sage Stoneware Mug',
                    sku: 'MUG-SAGE',
                    quantity: 2,
                    price: 18,
                    total: '36.00',
                  },
                  {
                    name: 'Linen Napkin Set',
                    sku: 'NAP-LIN',
                    quantity: 1,
                    price: 24,
                    total: '24.00',
                  },
                ],
              },
              {
                id: 52,
                number: '1052',
                status: 'processing',
                currency: 'USD',
                date_created_gmt: '2026-10-03T12:30:00',
                billing: { first_name: 'Juniper', last_name: 'House' },
                line_items: [
                  {
                    name: 'Sage Stoneware Mug',
                    sku: 'MUG-SAGE',
                    quantity: 1,
                    price: 18,
                    total: '18.00',
                  },
                ],
              },
              {
                id: 53,
                number: '1053',
                status: 'checkout-draft',
                currency: 'USD',
                date_created_gmt: '2026-10-04T12:30:00',
                line_items: [{ name: 'Linen Napkin Set', quantity: 9, total: '216.00' }],
              },
            ],
      );
    return undefined;
  };

  it('sends the owner to their own store to approve, then keeps only a key that works there', async () => {
    handlers = [store];
    const { url } = beginWooConnect(b.member, b.owner, 'shop.fernwood.test/wp-admin');
    const auth = new URL(url);
    expect(auth.origin + auth.pathname).toBe(`${STORE}/wc-auth/v1/authorize`);
    expect(auth.searchParams.get('scope')).toBe('read');
    expect(auth.searchParams.get('callback_url')).toBe(
      'https://app.example.test/api/connect/woocommerce/keys',
    );
    const token = auth.searchParams.get('user_id')!;
    // Not ours, or a key that doesn't work on the store: nothing kept.
    expect(
      await receiveWooKeys(
        { ...keys, user_id: 'forged', key_id: 1, key_permissions: 'read' },
        b.queue,
      ),
    ).toBe(false);
    expect(
      await receiveWooKeys(
        {
          consumer_key: `ck_${'z'.repeat(40)}`,
          consumer_secret: keys.consumer_secret,
          user_id: token,
          key_id: 1,
          key_permissions: 'read',
        },
        b.queue,
      ),
    ).toBe(false);
    expect(
      await receiveWooKeys(
        { ...keys, user_id: token, key_id: 1, key_permissions: 'read' },
        b.queue,
        new Date(Date.now() + 11 * 60_000),
      ),
    ).toBe(false);

    expect(
      await receiveWooKeys(
        { ...keys, user_id: token, key_id: 1, key_permissions: 'read' },
        b.queue,
      ),
    ).toBe(true);
    const [c] = await getAppDb()
      .select()
      .from(connection)
      .where(eq(connection.workspaceId, b.member.workspace.id));
    expect(c).toMatchObject({
      kind: 'woocommerce',
      externalId: STORE,
      name: 'Fernwood Home Online',
    });
    expect(c!.secret).not.toContain('ck_');
    await b.queue.drain({ budgetMs: 60_000 });
    const [after] = await getAppDb().select().from(connection).where(eq(connection.id, c!.id));
    const kinds = await b.importAll(after!.lastRunId!);
    expect(kinds).toEqual(expect.arrayContaining(['product', 'customer', 'sale', 'sale_line']));
    // The checkout draft isn't an order yet.
    expect(await b.count('SELECT count(DISTINCT order_number) AS n FROM sales')).toBe(2);
    expect(await b.count('SELECT round(sum(line_total) * 100)::int AS n FROM sale_lines')).toBe(
      7800,
    );
    // Each option of a product with options is its own product.
    expect(
      await b.count("SELECT count(*) AS n FROM products WHERE sku IN ('APR-S', 'APR-L')"),
    ).toBe(2);
  }, 240_000);
});
