import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { closePools, connection, getAppDb, localStorage, setStorageForTests, user } from '@bizr/db';
import { resetEnvCache } from '@bizr/platform';
import { databaseAvailable } from '@bizr/platform/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { executeTenantQuery } from '../../executor/execute';
import { ingestionJobs } from '../../ingestion/jobs';
import { approveRun, getRunView, type RunView } from '../../ingestion/service';
import { JobRegistry, type JobEnqueuer } from '../../jobs/define';
import { JobQueue } from '../../jobs/queue';
import {
  createWorkspace,
  deleteWorkspace,
  getMemberWorkspace,
  type MemberWorkspace,
} from '../../workspaces/service';
import { setConnectorFetch } from '../fetch';
import { connectionsDailyJob, connectionSyncJob } from '../jobs';
import { openSecret, sealSecret } from '../secret';
import { listConnections, syncConnection } from '../service';
import { beginShopifyInstall, completeShopifyInstall, handleShopifyWebhook } from './service';
import { accessTokenFor } from './store';

/**
 * M10 acceptance (ADR-059): connecting a store through Shopify's sign-in brings its products,
 * customers and orders in through the normal import; the token is stored encrypted; a later change
 * comes in by itself; removing the app stops everything. Shopify is played back, never called.
 */
const hasDb = await databaseAvailable();
const SECRET = 'shpss_integration_secret_0123456789';
const SHOP = 'fernwood-test.myshopify.com';

interface Order {
  name: string;
  createdAt: string;
  customer: string;
  lines: [sku: string, name: string, qty: number, price: string][];
}

describe.skipIf(!hasDb)('Shopify (integration)', () => {
  const saved = { ...process.env };
  let owner: string;
  let member: MemberWorkspace;
  let queue: JobQueue;
  let enqueue: JobEnqueuer;
  let connectionId: string;
  const orders: Order[] = [
    {
      name: '#1001',
      createdAt: '2026-10-01T10:00:00Z',
      customer: 'Bloom & Co',
      lines: [
        ['MUG-SAGE', 'Sage Stoneware Mug', 2, '18.00'],
        ['NAP-LIN', 'Linen Napkin Set', 1, '24.00'],
      ],
    },
    {
      name: '#1002',
      createdAt: '2026-10-03T12:30:00Z',
      customer: 'Juniper House',
      lines: [['CAN-FIG', 'Fig Leaf Candle', 3, '22.00']],
    },
    {
      name: '#1003',
      createdAt: '2026-10-05T09:15:00Z',
      customer: 'Bloom & Co',
      lines: [['MUG-SAGE', 'Sage Stoneware Mug', 1, '18.00']],
    },
  ];
  const products = [
    ['Sage Stoneware Mug', 'MUG-SAGE', '18.00', '6.50', 14],
    ['Linen Napkin Set', 'NAP-LIN', '24.00', '9.00', 30],
    ['Fig Leaf Candle', 'CAN-FIG', '22.00', '7.25', 8],
  ] as const;
  let refreshes = 0;

  const page = <N>(nodes: N[]) => ({ pageInfo: { hasNextPage: false, endCursor: null }, nodes });
  const shopify = async (url: string, init: RequestInit): Promise<Response> => {
    const u = new URL(url);
    expect(u.hostname).toBe(SHOP);
    if (u.pathname === '/admin/oauth/access_token') {
      const form = new URLSearchParams(init.body as string);
      if (form.get('grant_type') === 'refresh_token') refreshes += 1;
      return Response.json({
        access_token: `shpat_${refreshes}`,
        scope: 'read_products,read_inventory,read_orders,read_customers',
        expires_in: 3600,
        refresh_token: `shprt_${refreshes}`,
        refresh_token_expires_in: 7_776_000,
      });
    }
    const { query } = JSON.parse(init.body as string) as { query: string };
    if (query.includes('shop {'))
      return Response.json({ data: { shop: { name: 'Fernwood Home', currencyCode: 'USD' } } });
    if (query.includes('products('))
      return Response.json({
        data: {
          products: page(
            products.map(([title, sku, price, cost, qty]) => ({
              title,
              vendor: 'Clayworks',
              productType: 'Home',
              status: 'ACTIVE',
              variants: {
                nodes: [
                  {
                    title: 'Default Title',
                    sku,
                    price,
                    inventoryQuantity: qty,
                    inventoryItem: { unitCost: { amount: cost } },
                  },
                ],
              },
            })),
          ),
        },
      });
    if (query.includes('customers('))
      return Response.json({
        data: {
          customers: page([
            {
              displayName: 'Bloom & Co',
              email: 'orders@bloom.test',
              phone: null,
              createdAt: '2025-02-01T00:00:00Z',
            },
            {
              displayName: 'Juniper House',
              email: 'hello@juniper.test',
              phone: null,
              createdAt: '2025-05-01T00:00:00Z',
            },
          ]),
        },
      });
    return Response.json({
      data: {
        orders: page(
          orders.map((o) => ({
            name: o.name,
            createdAt: o.createdAt,
            cancelledAt: null,
            displayFinancialStatus: 'PAID',
            sourceName: 'web',
            customer: { displayName: o.customer, email: null },
            lineItems: {
              nodes: o.lines.map(([sku, name, quantity, price]) => ({
                sku,
                name,
                quantity,
                originalUnitPriceSet: { shopMoney: { amount: price } },
                discountedTotalSet: {
                  shopMoney: { amount: (Number(price) * quantity).toFixed(2) },
                },
              })),
            },
          })),
        ),
      },
    });
  };

  const drain = async (runId: string, done: (v: RunView) => boolean) => {
    let view: RunView | undefined;
    for (let i = 0; i < 30; i++) {
      await queue.drain({ budgetMs: 60_000 });
      view = await getRunView(member, runId);
      if (done(view)) return view;
    }
    throw new Error(`run did not finish: ${view?.run.status}`);
  };
  const count = async (sql: string) =>
    Number(
      (
        await executeTenantQuery({
          tenant: { workspaceId: member.workspace.id, tenantSchema: member.workspace.tenantSchema },
          sql,
          params: [],
          origin: 'system',
          path: 'system',
        })
      ).rows[0]!.n,
    );
  const latestRun = async () =>
    (await getAppDb().select().from(connection).where(eq(connection.id, connectionId)))[0]!
      .lastRunId!;

  beforeAll(async () => {
    process.env.SHOPIFY_CLIENT_ID = 'int-client-id';
    process.env.SHOPIFY_CLIENT_SECRET = SECRET;
    process.env.CONNECTOR_SECRET = 'int-connector-secret-0123456789abcdef';
    resetEnvCache();
    setStorageForTests(localStorage(mkdtempSync(path.join(tmpdir(), 'bizr-uploads-'))));
    setConnectorFetch(shopify);
    const [u] = await getAppDb()
      .insert(user)
      .values({ name: 'Shop Owner', email: `shopify-${crypto.randomUUID()}@example.test` })
      .returning({ id: user.id });
    owner = u!.id;
    const ws = await createWorkspace(owner, {
      name: 'Fernwood Shopify Test',
      packId: 'retail',
      currency: 'USD',
      timezone: 'America/New_York',
      dateOrder: 'MDY',
    });
    member = (await getMemberWorkspace(ws.slug, owner))!;
    queue = await JobQueue.start({
      registry: new JobRegistry([...ingestionJobs, connectionSyncJob, connectionsDailyJob]),
      supervise: false,
    });
    enqueue = (d, i, o) => queue.enqueue(d, i, o);
  }, 120_000);

  afterAll(async () => {
    setConnectorFetch(null);
    await queue?.stop();
    if (member) await deleteWorkspace(member, owner);
    if (owner) await getAppDb().delete(user).where(eq(user.id, owner));
    setStorageForTests(undefined);
    process.env = saved;
    resetEnvCache();
    await closePools();
  });

  const callback = (state: string, extra: Record<string, string> = {}) => {
    const params: Record<string, string> = {
      code: 'auth-code',
      shop: SHOP,
      state,
      timestamp: String(Math.floor(Date.now() / 1000)),
      ...extra,
    };
    const message = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    return new URLSearchParams({
      ...params,
      hmac: createHmac('sha256', SECRET).update(message).digest('hex'),
    });
  };

  it('refuses a callback that isn’t for this person and this request', async () => {
    const { url, cookie } = beginShopifyInstall(member, owner, 'fernwood-test');
    const state = new URL(url).searchParams.get('state')!;
    const attempts = [
      { params: callback('wrong-state'), cookie, sessionUserId: owner },
      { params: callback(state), cookie, sessionUserId: crypto.randomUUID() },
      { params: callback(state), cookie: undefined, sessionUserId: owner },
      { params: callback(state, { shop: 'other.myshopify.com' }), cookie, sessionUserId: owner },
      {
        params: new URLSearchParams({ ...Object.fromEntries(callback(state)), code: 'swapped' }),
        cookie,
        sessionUserId: owner,
      },
    ];
    for (const a of attempts)
      await expect(completeShopifyInstall({ ...a, queue })).rejects.toThrow(/didn’t work/);
    expect(await listConnections(member)).toHaveLength(0);
  });

  it('connects a store: token encrypted, first import reviewed by the owner', async () => {
    const { url, cookie } = beginShopifyInstall(member, owner, `https://${SHOP}/admin`);
    const done = await completeShopifyInstall({
      params: callback(new URL(url).searchParams.get('state')!),
      cookie,
      sessionUserId: owner,
      queue,
    });
    connectionId = done.connectionId;
    expect(done.slug).toBe(member.workspace.slug);
    const [c] = await getAppDb().select().from(connection).where(eq(connection.id, connectionId));
    expect(c).toMatchObject({ kind: 'shopify', externalId: SHOP, name: 'Fernwood Home' });
    expect(c!.secret).not.toContain('shpat_');
    expect(openSecret<{ accessToken: string }>(c!.secret!).accessToken).toBe('shpat_0');

    // The queued first check fetches the store and starts an import that waits for the owner.
    await queue.drain({ budgetMs: 60_000 });
    const runId = await latestRun();
    const review = await drain(runId, (v) => ['review', 'failed'].includes(v.run.status));
    expect(review.run.status).toBe('review');
    const kinds = review.proposal!.review.entities.map((e) => e.key);
    expect(kinds).toEqual(expect.arrayContaining(['product', 'customer', 'sale']));
    await approveRun({ member, userId: owner, runId, proposalId: review.proposal!.id, queue });
    await drain(runId, (v) => v.run.status === 'done');
    expect(await count('SELECT count(*) AS n FROM products WHERE _deleted_at IS NULL')).toBe(3);
    expect(await count('SELECT count(DISTINCT order_number) AS n FROM sales')).toBe(3);
  }, 240_000);

  it('brings a new order in by itself, refreshing the token when it’s about to expire', async () => {
    orders.push({
      name: '#1004',
      createdAt: '2026-10-20T16:00:00Z',
      customer: 'Juniper House',
      lines: [['NAP-LIN', 'Linen Napkin Set', 2, '24.00']],
    });
    // Two hours on: the hour-long token has expired.
    const later = new Date(Date.now() + 2 * 3600_000);
    expect(await syncConnection(connectionId, enqueue, later)).toBe('started');
    expect(refreshes).toBe(1);
    const [c] = await getAppDb().select().from(connection).where(eq(connection.id, connectionId));
    expect(openSecret<{ refreshToken: string }>(c!.secret!).refreshToken).toBe('shprt_1');
    const view = await drain(c!.lastRunId!, (v) => ['done', 'failed'].includes(v.run.status));
    expect(view.run.status).toBe('done');
    expect(await count('SELECT count(DISTINCT order_number) AS n FROM sales')).toBe(4);
  }, 240_000);

  it('keeps the tokens of a reconnect made while an old token was being refreshed', async () => {
    const db = getAppDb();
    const [stale] = await db.select().from(connection).where(eq(connection.id, connectionId));
    const reconnected = sealSecret({
      accessToken: 'shpat_reconnected',
      refreshToken: 'shprt_reconnected',
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    await db.update(connection).set({ secret: reconnected }).where(eq(connection.id, connectionId));
    const before = refreshes;
    expect(await accessTokenFor(stale!, new Date(Date.now() + 5 * 3600_000))).toBe(
      'shpat_reconnected',
    );
    expect(refreshes).toBe(before + 1);
    const [c] = await db.select().from(connection).where(eq(connection.id, connectionId));
    expect(c!.secret).toBe(reconnected);
  });

  it('stops when the app is removed from the store', async () => {
    await handleShopifyWebhook('app/uninstalled', SHOP, { id: 1 });
    const [view] = await listConnections(member);
    expect(view).toMatchObject({ status: 'disconnected' });
    const [c] = await getAppDb().select().from(connection).where(eq(connection.id, connectionId));
    expect(c!.secret).toBeNull();
    expect(await syncConnection(connectionId, enqueue, new Date(Date.now() + 5 * 3600_000))).toBe(
      'skipped',
    );
    // The records stay.
    expect(await count('SELECT count(*) AS n FROM products WHERE _deleted_at IS NULL')).toBe(3);
  });
});
