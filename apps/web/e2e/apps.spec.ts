import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test } from '@playwright/test';

/**
 * M16: the owner makes a key, another app reads the business with it (the API and an MCP client),
 * a webhook test arrives signed, and a revoked key stops working.
 */

test('the owner connects another app, an AI assistant and a webhook', async ({
  page,
  request,
  baseURL,
}, info) => {
  test.skip(info.project.name === 'mobile', 'Runs once, on desktop.');
  test.setTimeout(120_000);
  const received: { headers: IncomingHttpHeaders; body: string }[] = [];
  const receiver = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.end('ok');
    });
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
  const hookUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/bizr`;

  try {
    const business = `Apps Test ${Date.now()}`;
    await page.goto('/sign-up');
    await page.getByLabel('Your name').fill('Avery Owner');
    await page
      .getByLabel('Email')
      .fill(`apps-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`);
    await page.getByLabel('Password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Create my account' }).click();
    await page.getByLabel('What’s your business called?').fill(business);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/w\/[a-z0-9-]+\/home$/);
    const base = new URL(page.url()).pathname.replace(/\/home$/, '');

    await page.goto(`${base}/settings`);
    await page.getByRole('link', { name: 'Keys, AI assistants and webhooks' }).click();
    await expect(page.getByRole('heading', { name: 'Connect other apps' })).toBeVisible();

    // A key, shown once.
    await page.getByLabel('What will use it?').fill('Accounting add-on');
    await page.getByRole('button', { name: 'Make a key' }).click();
    const key = (await page.getByTestId('secret-value').textContent())!.trim();
    expect(key).toMatch(/^bzr_/);
    await expect(page.getByRole('list', { name: 'Keys' })).toContainText('Accounting add-on');

    // The API reads with it, and only with it.
    const auth = { authorization: `Bearer ${key}` };
    const info1 = await request.get('/api/v1/business', { headers: auth });
    expect(info1.status()).toBe(200);
    expect(await info1.json()).toMatchObject({ name: business, currency: 'USD' });
    expect((await request.get('/api/v1/business')).status()).toBe(401);
    const measures = (await (await request.get('/api/v1/measures', { headers: auth })).json()) as {
      measures: { key: string }[];
    };
    expect(measures.measures.map((m) => m.key)).toContain('net_sales');
    const bad = await request.post('/api/v1/query', { headers: auth, data: { sql: 'select 1' } });
    expect(bad.status()).toBe(400);
    expect((await request.get('/api/v1/openapi.json')).status()).toBe(200);

    // An MCP client (the official one) lists and calls the tools.
    const mcpUrl = (await page.getByTestId('mcp-url').textContent())!.trim();
    expect(mcpUrl).toBe(`${baseURL}/api/mcp`);
    const client = new Client({ name: 'e2e', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: auth } }),
    );
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('run_query');
    const r = await client.callTool({ name: 'get_business', arguments: {} });
    expect(r.structuredContent).toMatchObject({ name: business });
    await client.close();

    // A webhook: the test arrives, signed with the secret shown once.
    await page.getByLabel('Address to send to').fill(hookUrl);
    await page.getByRole('button', { name: 'Add webhook' }).click();
    await expect(page.getByRole('list', { name: 'Webhooks' })).toContainText(hookUrl);
    const secret = (await page
      .getByTestId('secret-value')
      .filter({ hasText: 'whsec_' })
      .textContent())!.trim();
    expect(secret).toMatch(/^whsec_/);
    await page.getByRole('button', { name: 'Send a test' }).click();
    await expect(page.getByTestId('webhook-note')).toHaveText(
      'Test sent: the address answered OK.',
    );
    const ping = received.at(-1)!;
    const [t, v1] = String(ping.headers['bizretriever-signature'])
      .split(',')
      .map((p) => p.split('=')[1]!);
    expect(createHmac('sha256', secret).update(`${t}.${ping.body}`).digest('hex')).toBe(v1);
    expect(JSON.parse(ping.body)).toMatchObject({ type: 'ping', business: { name: business } });

    // Revoked: refused straight away.
    await page.getByRole('list', { name: 'Keys' }).getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByRole('list', { name: 'Keys' })).toHaveCount(0);
    expect((await request.get('/api/v1/business', { headers: auth })).status()).toBe(401);
  } finally {
    receiver.close();
  }
});
