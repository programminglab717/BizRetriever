import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  localStorage,
  closePools,
  getAppDb,
  getPool,
  rowIssue,
  setStorageForTests,
  user,
} from '@bizr/db';
import { generateDemoDataset, type GroundTruth } from '@bizr/demo-data';
import { databaseAvailable } from '@bizr/platform/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { executeTenantQuery } from '../executor/execute';
import { JobRegistry } from '../jobs/define';
import { JobQueue } from '../jobs/queue';
import {
  createWorkspace,
  deleteWorkspace,
  getMemberWorkspace,
  type MemberWorkspace,
} from '../workspaces/service';
import { ingestApplyJob, ingestionJobs } from './jobs';
import {
  approveRun,
  getRunView,
  IngestionRequestError,
  reviseRun,
  startIngestion,
  type RunView,
} from './service';

/**
 * The whole import on the Fernwood demo files, through the real job system, storage and tenant
 * roles: analyze → answer a question → approve → records in the tenant tables match the answer key.
 * AI is replay-only in tests with no recordings, so this exercises the no-AI path end to end.
 */
const hasDb = await databaseAvailable();
const TODAY = '2026-10-13';

describe.skipIf(!hasDb)('ingestion (integration)', () => {
  let owner: string;
  let member: MemberWorkspace;
  let queue: JobQueue;
  let truth: GroundTruth;
  let files: { fileName: string; bytes: Uint8Array }[];
  let runId: string;

  const drainUntil = async (done: (v: RunView) => boolean): Promise<RunView> => {
    for (let i = 0; i < 20; i++) {
      await queue.drain({ budgetMs: 60_000 });
      const view = await getRunView(member, runId);
      if (done(view)) return view;
    }
    throw new Error('run did not finish');
  };

  const count = async (table: string) => {
    const r = await executeTenantQuery({
      tenant: { workspaceId: member.workspace.id, tenantSchema: member.workspace.tenantSchema },
      sql: `SELECT count(*)::int AS n FROM ${table}`,
      origin: 'system',
      path: 'system',
    });
    return r.rows[0]!.n as number;
  };

  beforeAll(async () => {
    setStorageForTests(localStorage(mkdtempSync(path.join(tmpdir(), 'bizr-uploads-'))));
    const dir = mkdtempSync(path.join(tmpdir(), 'fernwood-int-'));
    truth = await generateDemoDataset({ today: TODAY, seed: 42, outDir: dir });
    files = readdirSync(dir)
      .filter((f) => f !== 'ground_truth.json')
      .sort()
      .map((fileName) => ({ fileName, bytes: readFileSync(path.join(dir, fileName)) }));

    const [u] = await getAppDb()
      .insert(user)
      .values({ name: 'Importer', email: `importer-${crypto.randomUUID()}@example.test` })
      .returning({ id: user.id });
    owner = u!.id;
    const ws = await createWorkspace(owner, {
      name: 'Fernwood Import Test',
      packId: 'retail',
      currency: 'USD',
      timezone: 'America/New_York',
      dateOrder: 'MDY',
    });
    member = (await getMemberWorkspace(ws.slug, owner))!;
    // Unique queue names per run would need a custom registry; the ingestion jobs are idempotent and
    // keyed by run id, so sharing queues with other runs of this suite is safe.
    queue = await JobQueue.start({
      registry: new JobRegistry([...ingestionJobs]),
      supervise: false,
    });
  }, 60_000);

  afterAll(async () => {
    await queue?.stop();
    if (member) await deleteWorkspace(member, owner);
    if (owner) await getAppDb().delete(user).where(eq(user.id, owner));
    setStorageForTests(undefined);
    await closePools();
  });

  it('rejects files it can’t read before storing anything', async () => {
    await expect(
      startIngestion({
        member,
        userId: owner,
        files: [{ fileName: 'report.pdf', bytes: new Uint8Array([1]) }],
        queue,
      }),
    ).rejects.toThrow(IngestionRequestError);
  });

  it('analyzes the demo files and proposes a model for review', async () => {
    ({ runId } = await startIngestion({ member, userId: owner, files, queue }));
    const view = await drainUntil((v) => v.run.status === 'review' || v.run.status === 'failed');
    expect(view.run.status).toBe('review');
    const p = view.proposal!;
    expect(p.version).toBe(1);
    expect(p.origin).toBe('heuristic');
    const counts = Object.fromEntries(p.review.entities.map((e) => [e.key, e.count]));
    const c = truth.counts as Record<string, number>;
    expect(counts.product).toBe(c.products);
    expect(counts.sale).toBe(c.sales);
    expect(p.review.summary.template).toContain('{{product_count}}');
    expect(p.review.skipped.find((s) => s.reason === 'totals')?.count).toBeGreaterThan(0);
    expect(p.proposal.questions.length).toBeGreaterThan(0);
  }, 120_000);

  it('applies an answer as a new version', async () => {
    const before = (await getRunView(member, runId)).proposal!;
    const q = before.proposal.questions.find((x) => x.id.startsWith('dedupe-customer'))!;
    await reviseRun({
      member,
      userId: owner,
      runId,
      proposalId: before.id,
      action: { kind: 'answer', questionId: q.id, optionId: 'different' },
      queue,
    });
    const view = await drainUntil((v) => v.run.status === 'review' && v.proposal!.version === 2);
    const after = view.proposal!;
    expect(after.proposal.questions.map((x) => x.id)).not.toContain(q.id);
    const customers = (e: typeof after) =>
      e.review.entities.find((x) => x.key === 'customer')!.count;
    expect(customers(after)).toBeGreaterThan(customers(before));
    expect(after.changes.join(' ')).toMatch(/similar names apart/);

    // A stale page can't act on an old version.
    await expect(
      approveRun({ member, userId: owner, runId, proposalId: before.id, queue }),
    ).rejects.toThrow(/out of date/);

    // Undo the answer: back to the original numbers.
    await reviseRun({
      member,
      userId: owner,
      runId,
      proposalId: after.id,
      action: { kind: 'undo', index: 0 },
      queue,
    });
    const undone = await drainUntil((v) => v.run.status === 'review' && v.proposal!.version === 3);
    expect(customers(undone.proposal!)).toBe(customers(before));
  }, 120_000);

  it('sets up the records and loads them as the tenant writer', async () => {
    const latest = (await getRunView(member, runId)).proposal!;
    await approveRun({ member, userId: owner, runId, proposalId: latest.id, queue });
    const view = await drainUntil((v) => v.run.status === 'done' || v.run.status === 'failed');
    expect(view.run.status, view.jobError ?? '').toBe('done');

    const c = truth.counts as Record<string, number>;
    expect(await count('products')).toBe(c.products);
    expect(await count('sales')).toBe(c.sales);
    expect(await count('sale_lines')).toBe(c.saleLines);
    expect(await count('customers')).toBe(c.namedCustomers! + c.stockists!);
    expect(await count('returns')).toBe(c.returns);
    expect(await count('expenses')).toBe(c.expenseEntries);

    const tenant = {
      workspaceId: member.workspace.id,
      tenantSchema: member.workspace.tenantSchema,
    };
    // Links resolved to foreign keys; unmatched ones keep their text.
    const links = await executeTenantQuery({
      tenant,
      sql: `SELECT count(*) FILTER (WHERE product_id IS NOT NULL)::int AS linked,
                   count(*) FILTER (WHERE product_id IS NULL AND product_ref IS NOT NULL)::int AS kept
              FROM sale_lines`,
      origin: 'system',
      path: 'system',
    });
    expect(links.rows[0]!.linked).toBeGreaterThan(c.saleLines! * 0.95);
    expect(links.rows[0]!.kept).toBeGreaterThan(0);
    // Money is exact: numeric, never float noise; lineage points at the upload.
    const money = await executeTenantQuery({
      tenant,
      sql: `SELECT unit_price::text AS price, _source_upload_id, _source_row FROM sale_lines LIMIT 1`,
      origin: 'system',
      path: 'system',
    });
    expect(money.rows[0]!.price).toMatch(/^-?\d+\.\d{4}$/);
    expect(money.rows[0]!._source_upload_id).toBeTruthy();

    expect(view.report).toMatchObject({ entities: expect.any(Array) as unknown });
    const issues = await getAppDb().select().from(rowIssue).where(eq(rowIssue.runId, runId));
    expect(issues.some((i) => i.code === 'skipped_totals')).toBe(true);

    // The load ran as the writer role, not the admin: the query log has it.
    const log = await getPool('admin').query<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.query_run WHERE workspace_id = $1 AND sql_text LIKE 'ingest.apply load%'`,
      [member.workspace.id],
    );
    expect(log.rows[0]!.n).toBe(1);
  }, 180_000);

  it('re-running the load is harmless (idempotent apply)', async () => {
    const before = await count('sale_lines');
    const proposal = (await getRunView(member, runId)).proposal!;
    await queue.enqueue(
      ingestApplyJob,
      { runId, proposalId: proposal.id, userId: owner },
      { workspaceId: member.workspace.id },
    );
    await queue.drain({ budgetMs: 60_000 });
    expect(await count('sale_lines')).toBe(before);
    expect((await getRunView(member, runId)).run.status).toBe('done');
  }, 120_000);
});
