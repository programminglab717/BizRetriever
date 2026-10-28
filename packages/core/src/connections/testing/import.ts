import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { getAppDb, localStorage, setStorageForTests, user } from '@bizr/db';
import { eq } from 'drizzle-orm';

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
import { connectionsDailyJob, connectionSyncJob } from '../jobs';

/**
 * For connector tests (M18): a fresh business of a given industry, a job queue, and helpers to run
 * an import to review and to the end, and to count records.
 */
export interface ConnectorBench {
  member: MemberWorkspace;
  owner: string;
  queue: JobQueue;
  enqueue: JobEnqueuer;
  drain(runId: string, done: (v: RunView) => boolean): Promise<RunView>;
  /** To review, then approved, then done. Returns the reviewed record kinds. */
  importAll(runId: string): Promise<string[]>;
  count(sql: string): Promise<number>;
  dispose(): Promise<void>;
}

export async function connectorBench(
  name: string,
  packId: 'retail' | 'wholesale',
): Promise<ConnectorBench> {
  setStorageForTests(localStorage(mkdtempSync(path.join(tmpdir(), 'bizr-uploads-'))));
  const [u] = await getAppDb()
    .insert(user)
    .values({ name: 'Owner', email: `conn-${crypto.randomUUID()}@example.test` })
    .returning({ id: user.id });
  const owner = u!.id;
  const ws = await createWorkspace(owner, {
    name,
    packId,
    currency: 'USD',
    timezone: 'America/New_York',
    dateOrder: 'MDY',
  });
  const member = (await getMemberWorkspace(ws.slug, owner))!;
  const queue = await JobQueue.start({
    registry: new JobRegistry([...ingestionJobs, connectionSyncJob, connectionsDailyJob]),
    supervise: false,
  });
  const drain = async (runId: string, done: (v: RunView) => boolean) => {
    let view: RunView | undefined;
    for (let i = 0; i < 40; i++) {
      await queue.drain({ budgetMs: 60_000 });
      view = await getRunView(member, runId);
      if (done(view)) return view;
    }
    throw new Error(`run did not finish: ${view?.run.status}`);
  };
  return {
    member,
    owner,
    queue,
    enqueue: (d, i, o) => queue.enqueue(d, i, o),
    drain,
    async importAll(runId) {
      const review = await drain(runId, (v) => ['review', 'failed'].includes(v.run.status));
      if (review.run.status !== 'review') throw new Error(`import failed: ${review.run.error}`);
      const kinds = review.proposal!.review.entities.map((e) => e.key);
      await approveRun({ member, userId: owner, runId, proposalId: review.proposal!.id, queue });
      const done = await drain(runId, (v) => ['done', 'failed'].includes(v.run.status));
      if (done.run.status !== 'done') throw new Error(`apply failed: ${done.run.error}`);
      return kinds;
    },
    async count(sql) {
      const r = await executeTenantQuery({
        tenant: { workspaceId: member.workspace.id, tenantSchema: member.workspace.tenantSchema },
        sql,
        params: [],
        origin: 'system',
        path: 'system',
      });
      return Number(r.rows[0]!.n);
    },
    async dispose() {
      await queue.stop();
      await deleteWorkspace(member, owner);
      await getAppDb().delete(user).where(eq(user.id, owner));
      setStorageForTests(undefined);
    },
  };
}
