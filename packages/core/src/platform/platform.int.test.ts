import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { apiKey, closePools, getAppDb, webhook, webhookDelivery } from '@bizr/db';
import { resetEnvCache } from '@bizr/platform';
import { databaseAvailable } from '@bizr/platform/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { askQuestion } from '../ask/service';
import { saveAlertSetting } from '../insights/feed';
import { runInsights } from '../insights/service';
import { loadDemoWorkspace, type DemoWorkspace } from '../testing';
import { NotAllowedError, type MemberWorkspace } from '../workspaces/service';
import { apiDashboard, askApi, listApiInsights, listMeasures, runApiQuery } from './api';
import { API_RATE_PER_MINUTE, authenticateApiKey, createApiKey, revokeApiKey } from './keys';
import { handleMcpMessage } from './mcp';
import {
  createWebhook,
  deliverDueWebhooks,
  MAX_ATTEMPTS,
  recordInsightEvents,
  recordWebhookEvent,
  sendTestWebhook,
  verifyWebhookSignature,
} from './webhooks';

/** M16 acceptance (ADR-066): keys read one business and change nothing; webhooks arrive signed. */
const hasDb = await databaseAvailable();
const TODAY = '2026-10-13';
const NOW = new Date(`${TODAY}T16:00:00Z`);
const noAi = { provider: null, aiMode: 'never' as const };

interface Received {
  headers: IncomingMessage['headers'];
  body: string;
}

describe.skipIf(!hasDb)('connect other apps (integration)', () => {
  let demo: DemoWorkspace;
  let key: string;
  let apiMember: MemberWorkspace;
  let server: Server;
  let receiverUrl: string;
  const received: Received[] = [];
  /** Status codes the receiver answers with, in turn (then 200). */
  const answers: number[] = [];

  beforeAll(async () => {
    process.env.CONNECTOR_SECRET = 'int-connector-secret-0123456789abcdef';
    process.env.WEBHOOKS_ALLOW_PRIVATE = 'on';
    resetEnvCache();
    demo = await loadDemoWorkspace({ today: TODAY, name: 'Fernwood Platform Test' });
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.statusCode = answers.shift() ?? 200;
        res.end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    receiverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  }, 240_000);
  afterAll(async () => {
    server?.close();
    await demo?.dispose();
    delete process.env.WEBHOOKS_ALLOW_PRIVATE;
    resetEnvCache();
    await closePools();
  });

  it('makes a key only for the owner, and shows it once', async () => {
    const r = await createApiKey(demo.member, demo.ownerId, { name: '  Accounting add-on ' });
    key = r.key;
    expect(key).toMatch(/^bzr_[A-Za-z0-9_-]{32}$/);
    expect(r.view).toMatchObject({ name: 'Accounting add-on', prefix: key.slice(0, 10) });
    const [row] = await getAppDb().select().from(apiKey).where(eq(apiKey.id, r.view.id));
    expect(row!.hash).not.toContain(key.slice(4));
    await expect(
      createApiKey({ ...demo.member, role: 'member' }, demo.ownerId, { name: 'x' }),
    ).rejects.toThrow(NotAllowedError);
  });

  it('reads as a viewer of that business only, and can’t change anything', async () => {
    const auth = await authenticateApiKey(key, NOW);
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    apiMember = auth.member;
    expect(apiMember.role).toBe('viewer');
    expect(apiMember.workspace.id).toBe(demo.member.workspace.id);
    await expect(
      saveAlertSetting(apiMember, demo.ownerId, 'stockout_risk', {
        enabled: false,
        thresholds: {},
      }),
    ).rejects.toThrow(NotAllowedError);
    expect(await authenticateApiKey(`${key}x`, NOW)).toEqual({ ok: false, reason: 'unauthorized' });
    expect(await authenticateApiKey(null, NOW)).toEqual({ ok: false, reason: 'unauthorized' });
  });

  it('gives the same numbers as Ask for the same question', async () => {
    const q = await runApiQuery(
      apiMember,
      { metrics: ['net_sales'], timeRange: { preset: 'last_month' } },
      NOW,
    );
    expect(q.period).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    const a = await askQuestion(
      demo.member,
      demo.ownerId,
      {
        question: 'How much did I sell last month?',
      },
      noAi,
    );
    const askRow = a.content.data!.rows[0]!;
    const col = a.content.data!.columns.find((c) => c.metric === 'net_sales')!.key;
    const apiCol = q.columns.find((c) => c.kind === 'metric')!.key;
    expect(String(q.rows[0]![apiCol])).toBe(String(askRow[col]));
    expect(q.text[0]![apiCol]).toMatch(/^\$[\d,]+\.\d\d$/);

    const byChannel = await runApiQuery(
      apiMember,
      {
        metrics: ['net_sales'],
        dimensions: [{ field: 'sale.channel' }],
        timeRange: { preset: 'last_month' },
      },
      NOW,
    );
    expect(byChannel.rows.length).toBeGreaterThan(1);
    expect(byChannel.title).toBe('Net sales by sold through · September 2026');
  });

  it('refuses queries it can’t run, in plain words', async () => {
    await expect(runApiQuery(apiMember, { metrics: ['nope'] })).rejects.toMatchObject({
      status: 422,
      code: 'unknown_measure',
    });
    await expect(runApiQuery(apiMember, { sql: 'select * from pg_user' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      runApiQuery(apiMember, { metrics: ['net_sales'], dimensions: [{ field: 'secret.table' }] }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('answers questions, lists measures, insights and the dashboard', async () => {
    const m = await listMeasures(apiMember);
    expect(m.measures.find((x) => x.key === 'net_sales')).toMatchObject({ available: true });
    expect(m.details.map((d) => d.key)).toContain('product.category');
    const a = await askApi(apiMember, { question: 'Net sales by channel last month' }, noAi);
    expect(a.kind).toBe('query');
    expect(a.answer).toMatch(/\$/);
    expect(a.table!.rows.length).toBeGreaterThan(1);
    await runInsights(demo.member, { trigger: 'import', now: NOW, provider: null });
    const i = await listApiInsights(apiMember);
    expect(i.insights.length).toBeGreaterThan(0);
    expect(i.insights[0]!.text.length).toBeGreaterThan(10);
    const d = await apiDashboard(apiMember);
    expect(d.tiles.some((t) => t.title === 'Net sales')).toBe(true);
    expect(d.tiles.filter((t) => t.error)).toEqual([]);
  }, 60_000);

  it('serves the same reads over MCP', async () => {
    const r = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'run_query',
          arguments: { metrics: ['net_sales'], timeRange: { preset: 'last_month' } },
        },
      },
      { member: apiMember, ask: noAi },
    );
    const result = (
      r as { result: { structuredContent: { rows: unknown[] }; content: { text: string }[] } }
    ).result;
    const direct = await runApiQuery(apiMember, {
      metrics: ['net_sales'],
      timeRange: { preset: 'last_month' },
    });
    expect(result.structuredContent.rows).toEqual(direct.rows);
    expect(result.content[0]!.text).toMatch(/^The values below are this business’s own records/);
  });

  it('limits requests per minute, and stops a revoked key at once', async () => {
    const r = await createApiKey(demo.member, demo.ownerId, { name: 'Busy script' });
    const minute = new Date('2026-10-13T16:05:10Z');
    for (let i = 0; i < API_RATE_PER_MINUTE; i++)
      expect((await authenticateApiKey(r.key, minute)).ok).toBe(true);
    const over = await authenticateApiKey(r.key, minute);
    expect(over).toMatchObject({ ok: false, reason: 'rate_limited', retryAfter: 50 });
    expect((await authenticateApiKey(r.key, new Date('2026-10-13T16:06:00Z'))).ok).toBe(true);
    await revokeApiKey(demo.member, demo.ownerId, r.view.id);
    expect(await authenticateApiKey(r.key, new Date('2026-10-13T16:07:00Z'))).toEqual({
      ok: false,
      reason: 'unauthorized',
    });
  });

  it('delivers each event once, signed with the secret shown at the start', async () => {
    const { secret, view } = await createWebhook(demo.member, demo.ownerId, {
      url: receiverUrl,
      events: ['insight.created', 'import.completed'],
    });
    expect(secret).toMatch(/^whsec_/);
    const data = { import: { id: 'abc' } };
    expect(
      await recordWebhookEvent(demo.member.workspace.id, 'import.completed', 'import:abc', data),
    ).toBe(1);
    expect(
      await recordWebhookEvent(demo.member.workspace.id, 'import.completed', 'import:abc', data),
    ).toBe(0);
    received.length = 0;
    expect(await deliverDueWebhooks({ workspaceId: demo.member.workspace.id })).toEqual({
      attempted: 1,
      sent: 1,
    });
    expect(await deliverDueWebhooks({ workspaceId: demo.member.workspace.id })).toEqual({
      attempted: 0,
      sent: 0,
    });
    const got = received[0]!;
    expect(got.headers['bizretriever-event']).toBe('import.completed');
    expect(
      verifyWebhookSignature(secret, String(got.headers['bizretriever-signature']), got.body),
    ).toBe(true);
    expect(JSON.parse(got.body)).toMatchObject({
      id: 'import:abc',
      type: 'import.completed',
      business: { name: 'Fernwood Platform Test' },
      data,
    });

    // New insights become events too.
    const rows = await listApiInsights(apiMember, { limit: 2 });
    expect(
      await recordInsightEvents(
        demo.member.workspace.id,
        rows.insights.map((i) => i.id),
      ),
    ).toBe(2);
    received.length = 0;
    await deliverDueWebhooks({ workspaceId: demo.member.workspace.id });
    const bodies = received.map(
      (r) => JSON.parse(r.body) as { type: string; data: { insight: { text: string } } },
    );
    expect(bodies.map((b) => b.type)).toEqual(['insight.created', 'insight.created']);
    expect(bodies[0]!.data.insight.text.length).toBeGreaterThan(10);

    const test = await sendTestWebhook(demo.member, demo.ownerId, view.id);
    expect(test).toEqual({ ok: true, status: 200, error: null });
  });

  it('retries a failing receiver, then turns the webhook off', async () => {
    const [w] = await getAppDb()
      .select()
      .from(webhook)
      .where(eq(webhook.workspaceId, demo.member.workspace.id));
    await recordWebhookEvent(demo.member.workspace.id, 'import.completed', 'import:retry', {});
    answers.push(500);
    let clock = Date.now();
    const now = () => new Date(clock);
    expect(await deliverDueWebhooks({ workspaceId: demo.member.workspace.id, now })).toEqual({
      attempted: 1,
      sent: 0,
    });
    // Not again until its wait is over.
    expect(
      (await deliverDueWebhooks({ workspaceId: demo.member.workspace.id, now })).attempted,
    ).toBe(0);
    clock += 61_000;
    expect(await deliverDueWebhooks({ workspaceId: demo.member.workspace.id, now })).toEqual({
      attempted: 1,
      sent: 1,
    });

    // A receiver that never recovers: off after the last try.
    await recordWebhookEvent(demo.member.workspace.id, 'import.completed', 'import:dead', {});
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      answers.push(503);
      await deliverDueWebhooks({ workspaceId: demo.member.workspace.id, now });
      clock += 25 * 3_600_000;
    }
    const [d] = await getAppDb()
      .select()
      .from(webhookDelivery)
      .where(eq(webhookDelivery.eventKey, 'import:dead'));
    expect(d).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, lastStatus: 503 });
    const [after] = await getAppDb().select().from(webhook).where(eq(webhook.id, w!.id));
    expect(after!.disabledAt).not.toBeNull();
    expect(
      await recordWebhookEvent(demo.member.workspace.id, 'import.completed', 'import:later', {}),
    ).toBe(0);
  });
});
