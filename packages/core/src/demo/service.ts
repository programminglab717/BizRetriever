import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { getAppDb, workspace, workspaceMember } from '@bizr/db';
import { generateDemoDataset, generateNextMonthUpdate, type GroundTruth } from '@bizr/demo-data';
import { getLogger } from '@bizr/platform';
import { and, eq } from 'drizzle-orm';

import type { JobQueue } from '../jobs/queue';
import { approveRun, getRunView, startIngestion, type RunView } from '../ingestion/service';
import {
  createWorkspace,
  deleteWorkspace,
  getMemberWorkspace,
  type MemberWorkspace,
} from '../workspaces/service';

/**
 * The demo shop (M8): Fernwood Home & Gift, generated for today so every story is current, and
 * brought in through the normal import (rules only, no AI). "Try the demo shop" starts the live
 * import; the demo machine (`pnpm demo:up`) also finishes it, for the pre-imported backup tab.
 */

export const DEMO_SHOP_NAME = 'Fernwood Home & Gift';
const DEMO_TIMEZONE = 'America/New_York';
const log = () => getLogger('demo');

export interface DemoFile {
  fileName: string;
  bytes: Uint8Array;
}

/** "Today" in the demo shop's time zone. */
export function demoToday(now = new Date(), timezone = DEMO_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function readDir(dir: string, skip: string): DemoFile[] {
  return readdirSync(dir)
    .filter((f) => f !== skip)
    .sort()
    .map((fileName) => ({
      fileName,
      bytes: new Uint8Array(readFileSync(path.join(dir, fileName))),
    }));
}

/** The messy demo files for a given day, and their answer key. */
export async function demoFiles(
  options: { today?: string; seed?: number } = {},
): Promise<{ files: DemoFile[]; truth: GroundTruth }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'fernwood-'));
  try {
    const truth = await generateDemoDataset({
      today: options.today ?? demoToday(),
      seed: options.seed ?? 42,
      outDir: dir,
    });
    return { files: readDir(dir, 'ground_truth.json'), truth };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Next month's website export, for the re-upload scene. */
export async function demoNextMonthFile(options: { today?: string; seed?: number } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fernwood-next-'));
  try {
    const truth = await generateNextMonthUpdate({
      today: options.today ?? demoToday(),
      seed: options.seed ?? 42,
      outDir: dir,
    });
    return { files: readDir(dir, 'next_month_truth.json'), truth };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Removes the demo shops this person owns (a fresh start). */
export async function removeDemoShops(userId: string): Promise<number> {
  const owned = await getAppDb()
    .select({ slug: workspace.slug })
    .from(workspace)
    .innerJoin(workspaceMember, eq(workspaceMember.workspaceId, workspace.id))
    .where(
      and(
        eq(workspace.isDemo, true),
        eq(workspaceMember.userId, userId),
        eq(workspaceMember.role, 'owner'),
      ),
    );
  for (const { slug } of owned) {
    const member = await getMemberWorkspace(slug, userId);
    if (member) await deleteWorkspace(member, userId);
  }
  return owned.length;
}

/**
 * "Try the demo shop": a fresh demo business with today's demo files, and its import started.
 * An existing demo shop of this person's is replaced (they can reset it any time).
 */
export async function startDemoShop(input: {
  userId: string;
  queue: JobQueue;
  name?: string;
  now?: Date;
}): Promise<{ member: MemberWorkspace; runId: string }> {
  await removeDemoShops(input.userId);
  const ws = await createWorkspace(
    input.userId,
    {
      name: input.name ?? DEMO_SHOP_NAME,
      packId: 'retail',
      currency: 'USD',
      timezone: DEMO_TIMEZONE,
      dateOrder: 'MDY',
    },
    { isDemo: true },
  );
  const member = (await getMemberWorkspace(ws.slug, input.userId))!;
  const { files } = await demoFiles({ today: demoToday(input.now) });
  const { runId } = await startIngestion({
    member,
    userId: input.userId,
    files,
    queue: input.queue,
  });
  log().info({ workspaceId: ws.id, runId }, 'demo shop started');
  return { member, runId };
}

/**
 * Finishes a demo import right away: waits for "Here's what we found", accepts it as proposed
 * (the default answers) and waits for the records and insights. For the demo machine and tests.
 */
export async function finishDemoImport(input: {
  member: MemberWorkspace;
  userId: string;
  runId: string;
  queue: JobQueue;
  timeoutMs?: number;
}): Promise<RunView> {
  const deadline = Date.now() + (input.timeoutMs ?? 180_000);
  const until = async (done: (v: RunView) => boolean): Promise<RunView> => {
    for (;;) {
      await input.queue.drain({ budgetMs: 30_000 });
      const view = await getRunView(input.member, input.runId);
      if (view.run.status === 'failed')
        throw new Error(`demo import failed: ${view.run.error ?? view.jobError ?? 'unknown'}`);
      if (done(view)) return view;
      if (Date.now() > deadline) throw new Error('demo import took too long');
    }
  };
  const review = await until((v) => v.run.status === 'review');
  await approveRun({
    member: input.member,
    userId: input.userId,
    runId: input.runId,
    proposalId: review.proposal!.id,
    queue: input.queue,
  });
  // `done` is set before the insights step; drain once more so they're in too.
  const done = await until((v) => v.run.status === 'done');
  await input.queue.drain({ budgetMs: 30_000 });
  return done;
}
