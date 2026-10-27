import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  closePools,
  connection,
  getAppDb,
  ingestionRun,
  localStorage,
  setStorageForTests,
  user,
  workspaceMember,
} from '@bizr/db';
import { generateDemoDataset, generateNextMonthUpdate, type NextMonthTruth } from '@bizr/demo-data';
import { databaseAvailable } from '@bizr/platform/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { executeTenantQuery } from '../executor/execute';
import { ingestionJobs } from '../ingestion/jobs';
import {
  approveRun,
  getRunView,
  mergeRun,
  startIngestion,
  type RunView,
} from '../ingestion/service';
import { JobRegistry, type JobEnqueuer } from '../jobs/define';
import { JobQueue } from '../jobs/queue';
import {
  createWorkspace,
  deleteWorkspace,
  getMemberWorkspace,
  type MemberWorkspace,
} from '../workspaces/service';
import { setConnectorFetch } from './fetch';
import { connectionsDailyJob, connectionSyncJob } from './jobs';
import {
  ConnectionError,
  linkGoogleSheet,
  listConnections,
  syncConnection,
  updateConnection,
} from './service';

/**
 * M10 acceptance (ADR-058): a linked Google Sheet's first import is reviewed by the owner; after
 * that, a changed sheet updates by itself, an unchanged one does nothing, and anything needing a
 * person waits. The network is never touched: Google's answers are played back.
 */
const hasDb = await databaseAvailable();
const TODAY = '2026-10-13';
const SHEET_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
const LINK = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe.skipIf(!hasDb)('linked sources (integration)', () => {
  let owner: string;
  let member: MemberWorkspace;
  let queue: JobQueue;
  let enqueue: JobEnqueuer;
  let next: NextMonthTruth;
  let orders: Uint8Array;
  let nextOrders: Uint8Array;
  /** What "Google" answers with now. */
  let serving: { status: number; bytes?: Uint8Array; location?: string } = { status: 200 };
  const requested: string[] = [];
  /** Runs once while "Google" is answering, to change things mid-check. */
  let duringFetch: (() => Promise<void>) | null = null;
  let clock = Date.now();
  const later = () => new Date((clock += 5 * 60_000));

  const drain = async (runId: string, done: (v: RunView) => boolean): Promise<RunView> => {
    let view: RunView | undefined;
    for (let i = 0; i < 30; i++) {
      await queue.drain({ budgetMs: 60_000 });
      view = await getRunView(member, runId);
      if (done(view)) return view;
    }
    throw new Error(`run did not finish: ${view?.run.status} ${view?.jobError ?? ''}`);
  };
  const settled = (v: RunView) =>
    ['review', 'merge_review', 'done', 'failed'].includes(v.run.status);
  const sales = async () =>
    Number(
      (
        await executeTenantQuery({
          tenant: {
            workspaceId: member.workspace.id,
            tenantSchema: member.workspace.tenantSchema,
          },
          sql: 'SELECT count(DISTINCT order_number) AS n FROM sales WHERE _deleted_at IS NULL',
          params: [],
          origin: 'system',
          path: 'system',
        })
      ).rows[0]!.n,
    );

  beforeAll(async () => {
    setStorageForTests(localStorage(mkdtempSync(path.join(tmpdir(), 'bizr-uploads-'))));
    const dir = mkdtempSync(path.join(tmpdir(), 'fernwood-linked-'));
    await generateDemoDataset({ today: TODAY, seed: 42, outDir: dir });
    const nextDir = mkdtempSync(path.join(tmpdir(), 'fernwood-linked-next-'));
    next = await generateNextMonthUpdate({ today: TODAY, seed: 42, outDir: nextDir });
    orders = readFileSync(path.join(dir, 'Online orders 2025-26.xlsx'));
    nextOrders = readFileSync(path.join(nextDir, 'Online orders 2025-26.xlsx'));

    setConnectorFetch(async (url) => {
      requested.push(url);
      if (new URL(url).hostname === 'accounts.google.com')
        return new Response('<html>Sign in</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      if (duringFetch) {
        const f = duringFetch;
        duringFetch = null;
        await f();
      }
      if (serving.location)
        return new Response(null, { status: 302, headers: { location: serving.location } });
      return new Response(serving.status === 200 ? (serving.bytes ?? orders) : 'Not here', {
        status: serving.status,
        headers: {
          'content-type': serving.status === 200 ? XLSX : 'text/html',
          'content-disposition': `attachment; filename="Online orders.xlsx"; filename*=UTF-8''Online%20orders.xlsx`,
        },
      });
    });

    const [u] = await getAppDb()
      .insert(user)
      .values({ name: 'Linker', email: `linked-${crypto.randomUUID()}@example.test` })
      .returning({ id: user.id });
    owner = u!.id;
    const ws = await createWorkspace(owner, {
      name: 'Fernwood Linked Test',
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

    // The shop's other files were uploaded by hand first.
    const files = readdirSync(dir)
      .filter((f) => f !== 'ground_truth.json' && f !== 'Online orders 2025-26.xlsx')
      .sort()
      .map((fileName) => ({ fileName, bytes: readFileSync(path.join(dir, fileName)) }));
    const { runId } = await startIngestion({ member, userId: owner, files, queue });
    const review = await drain(runId, settled);
    await approveRun({ member, userId: owner, runId, proposalId: review.proposal!.id, queue });
    expect((await drain(runId, (v) => v.run.status === 'done')).run.status).toBe('done');
  }, 300_000);

  afterAll(async () => {
    setConnectorFetch(null);
    await queue?.stop();
    if (member) await deleteWorkspace(member, owner);
    if (owner) await getAppDb().delete(user).where(eq(user.id, owner));
    setStorageForTests(undefined);
    await closePools();
  });

  let connectionId: string;

  it('refuses links that aren’t Google Sheets, and explains a private sheet', async () => {
    for (const link of [
      'https://example.com/sheet',
      'http://docs.google.com/spreadsheets/d/x',
      'not a link',
    ])
      await expect(linkGoogleSheet({ member, userId: owner, link, queue })).rejects.toThrow(
        /doesn’t look like a Google Sheets link/,
      );
    serving = { status: 302, location: 'https://accounts.google.com/ServiceLogin?continue=x' };
    await expect(linkGoogleSheet({ member, userId: owner, link: LINK, queue })).rejects.toThrow(
      /isn’t shared/,
    );
    // A redirect anywhere but Google is never followed.
    serving = { status: 302, location: 'https://evil.example/steal' };
    await expect(linkGoogleSheet({ member, userId: owner, link: LINK, queue })).rejects.toThrow(
      ConnectionError,
    );
    expect(requested.every((u) => !u.includes('evil.example'))).toBe(true);
    expect(await listConnections(member)).toHaveLength(0);
    serving = { status: 200 };
  });

  it('links a sheet: the first import is the owner’s to check, as an upload is', async () => {
    const before = await sales();
    const linked = await linkGoogleSheet({ member, userId: owner, link: LINK, queue });
    connectionId = linked.connectionId;
    expect(requested.at(-1)).toBe(
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`,
    );
    const review = await drain(linked.runId, settled);
    expect(review.run).toMatchObject({ status: 'review', connectionId });
    await approveRun({
      member,
      userId: owner,
      runId: linked.runId,
      proposalId: review.proposal!.id,
      queue,
    });
    // Even with nothing to settle, the first comparison waits for the owner.
    const compare = await drain(linked.runId, (v) => v.run.status !== 'applying' && settled(v));
    expect(compare.run.status).toBe('merge_review');
    await mergeRun({ member, userId: owner, runId: linked.runId, resolutions: {}, queue });
    await drain(linked.runId, (v) => v.run.status === 'done');
    expect(await sales()).toBeGreaterThan(before);
    const [view] = await listConnections(member);
    expect(view).toMatchObject({
      name: 'Online orders',
      status: 'active',
      waitingRunId: null,
      link: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
    });
    await expect(linkGoogleSheet({ member, userId: owner, link: LINK, queue })).rejects.toThrow(
      /already linked/,
    );
  }, 240_000);

  it('does nothing when the sheet hasn’t changed, or when checked twice in a minute', async () => {
    const at = later();
    expect(await syncConnection(connectionId, enqueue, at)).toBe('unchanged');
    expect(await syncConnection(connectionId, enqueue, new Date(at.getTime() + 1_000))).toBe(
      'skipped',
    );
  });

  it('brings a changed sheet in by itself when nothing needs a person', async () => {
    const before = await sales();
    serving = { status: 200, bytes: nextOrders };
    expect(await syncConnection(connectionId, enqueue, later())).toBe('started');
    const [c] = await getAppDb().select().from(connection).where(eq(connection.id, connectionId));
    const view = await drain(c!.lastRunId!, (v) => ['done', 'failed'].includes(v.run.status));
    expect(view.run).toMatchObject({ status: 'done', kind: 'reupload' });
    expect(await sales()).toBe(before + next.added.length);
  }, 240_000);

  it('waits for the owner when automatic updates are off', async () => {
    await updateConnection(member, owner, connectionId, { autoUpdate: false });
    serving = { status: 200, bytes: orders };
    expect(await syncConnection(connectionId, enqueue, later())).toBe('started');
    const [c] = await getAppDb().select().from(connection).where(eq(connection.id, connectionId));
    const view = await drain(c!.lastRunId!, settled);
    expect(view.run.status).toBe('review');
    expect((await listConnections(member))[0]!.waitingRunId).toBe(c!.lastRunId);
    // While it waits, checking again starts nothing new.
    expect(await syncConnection(connectionId, enqueue, later())).toBe('busy');
  }, 240_000);

  it('says when a sheet stops being shared, or its owner leaves', async () => {
    const db = getAppDb();
    const [c] = await db.select().from(connection).where(eq(connection.id, connectionId));
    await db
      .update(ingestionRun)
      .set({ status: 'cancelled' })
      .where(eq(ingestionRun.id, c!.lastRunId!));
    serving = { status: 403 };
    expect(await syncConnection(connectionId, enqueue, later())).toBe('problem');
    let [view] = await listConnections(member);
    expect(view).toMatchObject({ status: 'needs_attention' });
    expect(view!.lastError).toMatch(/isn’t shared/);

    serving = { status: 200, bytes: nextOrders };
    await db
      .update(workspaceMember)
      .set({ status: 'invited' })
      .where(
        and(
          eq(workspaceMember.workspaceId, member.workspace.id),
          eq(workspaceMember.userId, owner),
        ),
      );
    expect(await syncConnection(connectionId, enqueue, later())).toBe('problem');
    [view] = await listConnections(member);
    expect(view!.lastError).toMatch(/no longer part of this business/);
    await db
      .update(workspaceMember)
      .set({ status: 'active' })
      .where(
        and(
          eq(workspaceMember.workspaceId, member.workspace.id),
          eq(workspaceMember.userId, owner),
        ),
      );
  }, 60_000);

  it('never undoes a pause made during a check, and runs one check of a source at a time', async () => {
    const db = getAppDb();
    const [before] = await db.select().from(connection).where(eq(connection.id, connectionId));
    serving = { status: 200, bytes: nextOrders };
    const at = later();
    let overlapping: string | undefined;
    duringFetch = async () => {
      // A second check (another press of "Update now", the daily job) while this one reads.
      overlapping = await syncConnection(connectionId, enqueue, new Date(at.getTime() + 120_000));
      await updateConnection(member, owner, connectionId, { paused: true });
    };
    expect(await syncConnection(connectionId, enqueue, at)).toBe('skipped');
    expect(overlapping).toBe('skipped');
    const [after] = await db.select().from(connection).where(eq(connection.id, connectionId));
    expect(after).toMatchObject({
      status: 'paused',
      syncingUntil: null,
      lastRunId: before!.lastRunId,
      lastFingerprint: before!.lastFingerprint,
    });
  }, 60_000);
});
