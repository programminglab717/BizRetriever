import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  closePools,
  getAppDb,
  localStorage,
  rowIssue,
  setStorageForTests,
  user,
  workspaceSettings,
} from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setConnectorFetch } from '../connections/fetch';
import { executeTenantQuery } from '../executor/execute';
import { ingestionJobs } from '../ingestion/jobs';
import { approveRun, getRunView, startIngestion, type RunView } from '../ingestion/service';
import { JobRegistry } from '../jobs/define';
import { JobQueue } from '../jobs/queue';
import { runQuery } from '../semantic/service';
import {
  createWorkspace,
  deleteWorkspace,
  getMemberWorkspace,
  SettingsLockedError,
  updateWorkspaceDetails,
  type MemberWorkspace,
} from '../workspaces/service';
import { ECB_HISTORY_URL, ECB_RECENT_URL } from './ecb';
import { resetRateFetches } from './rates';

/**
 * A US shop's order list with amounts in euros and dirhams (M20): euros are converted at the ECB's
 * rate for each order's date before loading; dirhams (no ECB rate) are left empty and reported.
 * The ECB answers from a sample file in its published format; nothing leaves the machine.
 */
const hasDb = await databaseAvailable();
const ecbXml = readFileSync(new URL('./testing/ecb-sample.xml', import.meta.url));

const CSV = [
  'Order ID,Order Date,Product,Quantity,Discount,Order Total,Currency',
  '1001,03/02/2026,Sage Mug,2,0,100.00,EUR',
  '1002,03/02/2026,Sage Mug,1,0,20.00,USD',
  '1003,03/01/2026,Sage Mug,1,0,50.00,EUR',
  '1004,03/02/2026,Sage Mug,3,0,367.00,AED',
].join('\n');

describe.skipIf(!hasDb)('other currencies (integration)', () => {
  let owner: string;
  let member: MemberWorkspace;
  let queue: JobQueue;
  let runId: string;
  const asked: string[] = [];

  const drainUntil = async (done: (v: RunView) => boolean): Promise<RunView> => {
    for (let i = 0; i < 20; i++) {
      await queue.drain({ budgetMs: 60_000 });
      const view = await getRunView(member, runId);
      if (done(view)) return view;
    }
    throw new Error('run did not finish');
  };

  beforeAll(async () => {
    setStorageForTests(localStorage(mkdtempSync(path.join(tmpdir(), 'bizr-fx-'))));
    resetRateFetches();
    setConnectorFetch(async (url) => {
      asked.push(url);
      if (url === ECB_RECENT_URL || url === ECB_HISTORY_URL)
        return new Response(ecbXml, { status: 200, headers: { 'content-type': 'text/xml' } });
      return new Response('not here', { status: 404 });
    });
    const [u] = await getAppDb()
      .insert(user)
      .values({ name: 'Currency', email: `fx-${crypto.randomUUID()}@example.test` })
      .returning({ id: user.id });
    owner = u!.id;
    const ws = await createWorkspace(owner, {
      name: 'Dollar Shop',
      packId: 'retail',
      currency: 'USD',
      timezone: 'America/New_York',
      dateOrder: 'MDY',
    });
    member = (await getMemberWorkspace(ws.slug, owner))!;
    queue = await JobQueue.start({
      registry: new JobRegistry([...ingestionJobs]),
      supervise: false,
    });
  }, 60_000);

  afterAll(async () => {
    setConnectorFetch(null);
    await queue?.stop();
    if (member) await deleteWorkspace(member, owner);
    if (owner) await getAppDb().delete(user).where(eq(user.id, owner));
    setStorageForTests(undefined);
    await closePools();
  });

  it('says on the review that amounts will be converted, and which can’t be', async () => {
    ({ runId } = await startIngestion({
      member,
      userId: owner,
      files: [{ fileName: 'orders.csv', bytes: new TextEncoder().encode(CSV) }],
      queue,
    }));
    const view = await drainUntil((v) => v.run.status === 'review' || v.run.status === 'failed');
    expect(view.run.status).toBe('review');
    const warnings = view.proposal!.review.warnings.join('\n');
    expect(warnings).toContain(
      '6 amounts in EUR converted to USD at the European Central Bank’s rate for each record’s date.',
    );
    expect(warnings).toMatch(/3 amounts in AED left empty: .* \(from 2026-03-02\)/);
    // March is more than 90 days back: the whole history was asked for.
    expect(asked).toContain(ECB_HISTORY_URL);
  }, 120_000);

  it('loads the converted amounts, exactly', async () => {
    const latest = (await getRunView(member, runId)).proposal!;
    await approveRun({ member, userId: owner, runId, proposalId: latest.id, queue });
    const view = await drainUntil((v) => v.run.status === 'done' || v.run.status === 'failed');
    expect(view.run.status, view.jobError ?? '').toBe('done');

    const rows = await executeTenantQuery({
      tenant: { workspaceId: member.workspace.id, tenantSchema: member.workspace.tenantSchema },
      sql: `SELECT s.order_number, l.line_total::text AS total, l.unit_price::text AS price
              FROM sale_lines l JOIN sales s ON s._id = l.sale_id ORDER BY s.order_number`,
      origin: 'system',
      path: 'system',
    });
    // Each line takes its order's date; the unit price worked out from the total (and discount)
    // is converted too: total, discount and unit price make 3 amounts per line.
    expect(rows.rows).toEqual([
      { order_number: '1001', total: '108.5000', price: '54.2500' }, // 100 EUR × 1.0850 (2 March)
      { order_number: '1002', total: '20.0000', price: '20.0000' }, // already dollars
      { order_number: '1003', total: '54.0000', price: '54.0000' }, // a Sunday: Friday's rate
      { order_number: '1004', total: null, price: null }, // no ECB rate for dirhams
    ]);
    const issues = await getAppDb().select().from(rowIssue).where(eq(rowIssue.runId, runId));
    expect(issues.some((i) => /no published exchange rate for AED/.test(i.message))).toBe(true);
  }, 180_000);

  it('remembers the converted currencies, and money answers say so', async () => {
    const [s] = await getAppDb()
      .select({ c: workspaceSettings.convertedCurrencies })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, member.workspace.id));
    expect(s!.c).toEqual(['EUR']);
    member = (await getMemberWorkspace(member.workspace.slug, owner))!;
    const sales = await runQuery(member, { metrics: ['net_sales'] }, 'system');
    expect(sales.assumptions.join(' ')).toContain(
      'Some amounts were in EUR: they were converted to USD at the European Central Bank’s rate',
    );
    const orders = await runQuery(member, { metrics: ['order_count'] }, 'system');
    expect(orders.assumptions.join(' ')).not.toContain('converted');
  }, 60_000);

  it('keeps the business currency fixed once records are in', async () => {
    await expect(
      updateWorkspaceDetails(member, owner, {
        name: 'Dollar Shop',
        currency: 'EUR',
        timezone: 'America/New_York',
        dateOrder: 'MDY',
      }),
    ).rejects.toThrow(SettingsLockedError);
    // Other details still change.
    await updateWorkspaceDetails(member, owner, {
      name: 'Dollar Shop Ltd',
      currency: 'USD',
      timezone: 'America/Chicago',
      dateOrder: 'MDY',
    });
  });
});
