import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { closePools, getAppDb, localStorage, setStorageForTests, user } from '@bizr/db';
import { generateDemoDataset, generateNextMonthUpdate, type NextMonthTruth } from '@bizr/demo-data';
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
import { ingestionJobs } from './jobs';
import { approveRun, getRunView, mergeRun, startIngestion, undoRun, type RunView } from './service';

/**
 * M6 acceptance: re-uploading next month's website export shows the right diff, merges without
 * losing anything (orders missing from the new export are kept), and can be undone.
 */
const hasDb = await databaseAvailable();
const TODAY = '2026-10-13';

describe.skipIf(!hasDb)('re-upload (integration)', () => {
  let owner: string;
  let member: MemberWorkspace;
  let queue: JobQueue;
  let next: NextMonthTruth;
  let nextFile: { fileName: string; bytes: Uint8Array };

  const drain = async (runId: string, done: (v: RunView) => boolean): Promise<RunView> => {
    for (let i = 0; i < 20; i++) {
      await queue.drain({ budgetMs: 60_000 });
      const view = await getRunView(member, runId);
      if (done(view)) return view;
    }
    throw new Error('run did not finish');
  };
  const settled = (v: RunView) =>
    ['review', 'merge_review', 'done', 'failed'].includes(v.run.status);
  const q = async (sql: string, params: unknown[] = []) =>
    (
      await executeTenantQuery({
        tenant: { workspaceId: member.workspace.id, tenantSchema: member.workspace.tenantSchema },
        sql,
        params,
        origin: 'system',
        path: 'system',
      })
    ).rows;
  const sales = async () =>
    Number((await q('SELECT count(*) AS n FROM sales WHERE _deleted_at IS NULL'))[0]!.n);
  const statusOf = async (numbers: string[]) =>
    (
      await q(
        'SELECT order_number, status FROM sales WHERE order_number = ANY($1) AND _deleted_at IS NULL',
        [numbers],
      )
    ).map((r) => String(r.status));
  const importFiles = async (files: { fileName: string; bytes: Uint8Array }[]) => {
    const { runId } = await startIngestion({ member, userId: owner, files, queue });
    const review = await drain(runId, settled);
    expect(review.run.status).toBe('review');
    await approveRun({ member, userId: owner, runId, proposalId: review.proposal!.id, queue });
    return { runId, view: await drain(runId, (v) => v.run.status !== 'applying' && settled(v)) };
  };

  beforeAll(async () => {
    setStorageForTests(localStorage(mkdtempSync(path.join(tmpdir(), 'bizr-uploads-'))));
    const dir = mkdtempSync(path.join(tmpdir(), 'fernwood-reupload-'));
    await generateDemoDataset({ today: TODAY, seed: 42, outDir: dir });
    const files = readdirSync(dir)
      .filter((f) => f !== 'ground_truth.json')
      .sort()
      .map((fileName) => ({ fileName, bytes: readFileSync(path.join(dir, fileName)) }));
    const nextDir = mkdtempSync(path.join(tmpdir(), 'fernwood-next-'));
    next = await generateNextMonthUpdate({ today: TODAY, seed: 42, outDir: nextDir });
    nextFile = {
      fileName: 'Online orders 2025-26.xlsx',
      bytes: readFileSync(path.join(nextDir, 'Online orders 2025-26.xlsx')),
    };

    const [u] = await getAppDb()
      .insert(user)
      .values({ name: 'Re-uploader', email: `reupload-${crypto.randomUUID()}@example.test` })
      .returning({ id: user.id });
    owner = u!.id;
    const ws = await createWorkspace(owner, {
      name: 'Fernwood Re-upload Test',
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
    const first = await importFiles(files);
    expect(first.view.run).toMatchObject({ kind: 'initial', status: 'done' });
  }, 240_000);

  afterAll(async () => {
    await queue?.stop();
    if (member) await deleteWorkspace(member, owner);
    if (owner) await getAppDb().delete(user).where(eq(user.id, owner));
    setStorageForTests(undefined);
    await closePools();
  });

  let runId: string;
  let before: number;

  it('recognises the file and previews exactly what changed', async () => {
    before = await sales();
    const r = await importFiles([nextFile]);
    runId = r.runId;
    expect(r.view.run).toMatchObject({ kind: 'reupload', status: 'merge_review' });
    const preview = r.view.merge!;
    expect(preview.matches.map((m) => m.label)).toEqual(
      expect.arrayContaining(['Online orders 2025-26.xlsx · Website']),
    );
    const sale = preview.entities.find((e) => e.entity === 'sale')!;
    expect(sale.new).toBe(next.added.length);
    expect(sale.changed).toBe(next.cancelled.length);
    expect(sale.missing).toBe(next.dropped.length);
    expect(sale.conflicts).toEqual([]);
    expect(sale.changeExamples.join(' ')).toMatch(/completed → cancelled/);
    const lines = preview.entities.find((e) => e.entity === 'sale_line')!;
    expect(lines.new).toBe(next.addedLines);
    // Nothing is written until the owner applies.
    expect(await sales()).toBe(before);
  }, 240_000);

  it('merges: new orders added, cancellations applied, missing orders kept', async () => {
    await mergeRun({ member, userId: owner, runId, resolutions: {}, queue });
    const view = await drain(runId, (v) => v.run.status === 'done' || v.run.status === 'failed');
    expect(view.run.status).toBe('done');
    expect(await sales()).toBe(before + next.added.length);
    expect(await statusOf(next.cancelled)).toEqual(next.cancelled.map(() => 'cancelled'));
    expect(await statusOf(next.dropped)).toHaveLength(next.dropped.length);
    const added = await q(
      'SELECT count(*) AS n FROM sale_lines l JOIN sales s ON s._id = l.sale_id WHERE s.order_number = ANY($1)',
      [next.added],
    );
    expect(Number(added[0]!.n)).toBe(next.addedLines);
    const linked = await q(
      'SELECT count(*) AS n FROM sale_lines l JOIN sales s ON s._id = l.sale_id WHERE s.order_number = ANY($1) AND l.product_id IS NOT NULL',
      [next.added],
    );
    expect(Number(linked[0]!.n)).toBe(next.addedLines);
  }, 240_000);

  it('the same file again changes nothing', async () => {
    const r = await importFiles([nextFile]);
    const sale = r.view.merge!.entities.find((e) => e.entity === 'sale')!;
    expect(sale).toMatchObject({ new: 0, changed: 0 });
  }, 240_000);

  it('undoes the whole update', async () => {
    const r = await undoRun(member, owner, runId);
    expect(r.edits).toBeGreaterThan(0);
    expect(await sales()).toBe(before);
    expect(await statusOf(next.cancelled)).toEqual(next.cancelled.map(() => 'completed'));
    await expect(undoRun(member, owner, runId)).rejects.toThrow(/already undone/);
  }, 120_000);
});
