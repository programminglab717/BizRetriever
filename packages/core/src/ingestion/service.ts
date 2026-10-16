import {
  getAppDb,
  getStorage,
  ingestionRun,
  jobRun,
  qualityReport,
  sha256Hex,
  sheetProfile,
  upload,
  uploadKey,
  type IngestionRun,
  type JobRunProgress,
} from '@bizr/db';
import type { RegionProfile } from '@bizr/ingest';
import { getPack } from '@bizr/packs';
import { getLogger } from '@bizr/platform';
import { and, desc, eq } from 'drizzle-orm';

import type { JobQueue } from '../jobs/queue';
import type { MemberWorkspace } from '../workspaces/service';
import { answerToCorrection, type Correction } from './corrections';
import { UndoError } from '../records/edits';
import type { MergePreview } from '../merge/service';
import { getMergePreview, ingestMergeJob, ReuploadError, undoReupload } from './reupload';
import { ingestAnalyzeJob, ingestApplyJob, ingestReviseJob } from './jobs';
import { latestProposal, type StoredProposal } from './pipeline';
import type { QuestionEffect } from './proposal';
import { effectProblems } from './validate';

/** What the web app calls to run an import (ARCHITECTURE §2). Every function checks the workspace. */

export const UPLOAD_LIMITS = {
  maxFiles: 10,
  /** ADR-024. */
  maxFileBytes: 25 * 1024 * 1024,
  extensions: ['xlsx', 'xlsm', 'xls', 'csv', 'tsv', 'txt'],
} as const;

/** A problem with the request that the user can fix. `message` is safe to show. */
export class IngestionRequestError extends Error {}

const log = () => getLogger('ingestion');

export interface IncomingFile {
  fileName: string;
  bytes: Uint8Array;
  mime?: string;
}

function checkFiles(files: readonly IncomingFile[]) {
  if (files.length === 0) throw new IngestionRequestError('Please choose at least one file.');
  if (files.length > UPLOAD_LIMITS.maxFiles)
    throw new IngestionRequestError(
      `Please upload at most ${UPLOAD_LIMITS.maxFiles} files at a time.`,
    );
  for (const f of files) {
    const ext = f.fileName.toLowerCase().split('.').pop() ?? '';
    if (!(UPLOAD_LIMITS.extensions as readonly string[]).includes(ext))
      throw new IngestionRequestError(
        `We can read Excel (.xlsx) and CSV files. “${f.fileName}” is a different kind of file.`,
      );
    if (f.bytes.byteLength === 0) throw new IngestionRequestError(`“${f.fileName}” is empty.`);
    if (f.bytes.byteLength > UPLOAD_LIMITS.maxFileBytes)
      throw new IngestionRequestError(`“${f.fileName}” is larger than 25 MB.`);
  }
}

/** Stores the originals, creates the run and queues the analysis. */
export async function startIngestion(input: {
  member: MemberWorkspace;
  userId: string;
  files: readonly IncomingFile[];
  queue: JobQueue;
}): Promise<{ runId: string }> {
  checkFiles(input.files);
  const ws = input.member.workspace;
  const storage = getStorage();
  const stored = await Promise.all(
    input.files.map(async (f) => {
      const sha256 = sha256Hex(f.bytes);
      const key = uploadKey(ws.id, sha256);
      await storage.put(key, f.bytes, ws.id);
      return { ...f, sha256, key };
    }),
  );

  const db = getAppDb();
  // A business that already has records is updating them: merge, don't load twice (ADR-043).
  const [previous] = await db
    .select({ id: ingestionRun.id })
    .from(ingestionRun)
    .where(and(eq(ingestionRun.workspaceId, ws.id), eq(ingestionRun.status, 'done')))
    .limit(1);
  const runId = await db.transaction(async (tx) => {
    const [run] = await tx
      .insert(ingestionRun)
      .values({
        workspaceId: ws.id,
        kind: previous ? 'reupload' : 'initial',
        createdBy: input.userId,
      })
      .returning({ id: ingestionRun.id });
    await tx.insert(upload).values(
      stored.map((f, position) => ({
        workspaceId: ws.id,
        runId: run!.id,
        position,
        fileName: f.fileName.slice(0, 255),
        sizeBytes: f.bytes.byteLength,
        mime: f.mime ?? null,
        sha256: f.sha256,
        storageKey: f.key,
        uploadedBy: input.userId,
      })),
    );
    return run!.id;
  });

  await queueJob(runId, 'analyzing', () =>
    input.queue.enqueue(ingestAnalyzeJob, { runId }, { workspaceId: ws.id }),
  );
  log().info({ runId, workspaceId: ws.id, files: stored.length }, 'ingestion started');
  return { runId };
}

async function queueJob(
  runId: string,
  status: IngestionRun['status'],
  enqueue: () => Promise<string>,
): Promise<void> {
  const db = getAppDb();
  try {
    const jobRunId = await enqueue();
    await db
      .update(ingestionRun)
      .set({ status, jobRunId, error: null, updatedAt: new Date() })
      .where(eq(ingestionRun.id, runId));
  } catch (err) {
    await db
      .update(ingestionRun)
      .set({
        status: 'failed',
        error: 'We couldn’t start working on your files. Please try again.',
      })
      .where(eq(ingestionRun.id, runId));
    throw err;
  }
}

async function getRun(member: MemberWorkspace, runId: string): Promise<IngestionRun> {
  const [run] = await getAppDb()
    .select()
    .from(ingestionRun)
    .where(and(eq(ingestionRun.id, runId), eq(ingestionRun.workspaceId, member.workspace.id)));
  if (!run) throw new IngestionRequestError('We couldn’t find that import.');
  return run;
}

export interface RunView {
  run: IngestionRun;
  progress: JobRunProgress | null;
  jobStatus: string | null;
  /** Job failure message (safe to show) when the background job failed. */
  jobError: string | null;
  proposal: StoredProposal | null;
  /** "What we've spotted so far" while the files are being analysed. */
  spotted: string[];
  files: { fileName: string; sizeBytes: number }[];
  report: unknown;
  /** Re-upload: what the new files would change (while the run is in `merge_review`). */
  merge: MergePreview | null;
}

/** Everything the processing, review and report screens poll for. */
export async function getRunView(member: MemberWorkspace, runId: string): Promise<RunView> {
  const run = await getRun(member, runId);
  const db = getAppDb();
  const [job] = run.jobRunId
    ? await db.select().from(jobRun).where(eq(jobRun.id, run.jobRunId))
    : [];
  const files = await db
    .select({ fileName: upload.fileName, sizeBytes: upload.sizeBytes })
    .from(upload)
    .where(eq(upload.runId, run.id))
    .orderBy(upload.position);
  const [report] = await db
    .select({ report: qualityReport.report })
    .from(qualityReport)
    .where(eq(qualityReport.runId, run.id));
  return {
    run,
    progress: job?.progress ?? null,
    jobStatus: job?.status ?? null,
    jobError: job?.status === 'failed' ? (job.error?.userMessage ?? null) : null,
    proposal: (await latestProposal(run.id)) ?? null,
    spotted:
      job?.jobName === ingestAnalyzeJob.name
        ? ((job.state as { spotted?: string[] }).spotted ?? [])
        : [],
    files,
    report: report?.report ?? null,
    merge: run.kind === 'reupload' ? ((await getMergePreview(run.id)) ?? null) : null,
  };
}

export async function listRuns(member: MemberWorkspace, limit = 20): Promise<IngestionRun[]> {
  return getAppDb()
    .select()
    .from(ingestionRun)
    .where(eq(ingestionRun.workspaceId, member.workspace.id))
    .orderBy(desc(ingestionRun.createdAt))
    .limit(limit);
}

async function draftFor(member: MemberWorkspace, runId: string, proposalId: string) {
  const run = await getRun(member, runId);
  if (run.status !== 'review')
    throw new IngestionRequestError('This import is busy. Please wait a moment and try again.');
  const latest = await latestProposal(run.id);
  if (!latest || latest.id !== proposalId || latest.status !== 'draft')
    throw new IngestionRequestError('This page is out of date. Please reload it.');
  return { run, latest };
}

export type ReviewAction =
  | { kind: 'answer'; questionId: string; optionId: string }
  | { kind: 'correct'; effect: QuestionEffect; label: string }
  | { kind: 'undo'; index: number }
  | { kind: 'note'; text: string };

/** A change on the review screen. Queues a revision; the screen polls until the new version is ready. */
export async function reviseRun(input: {
  member: MemberWorkspace;
  userId: string;
  runId: string;
  proposalId: string;
  action: ReviewAction;
  queue: JobQueue;
}): Promise<void> {
  const { latest } = await draftFor(input.member, input.runId, input.proposalId);
  let corrections: Correction[] = [...latest.corrections];
  let ownerRequest: string | undefined;
  const a = input.action;
  switch (a.kind) {
    case 'answer': {
      const c = answerToCorrection(latest.proposal, a.questionId, a.optionId);
      if (!c) throw new IngestionRequestError('That question has already been answered.');
      corrections.push(c);
      break;
    }
    case 'correct': {
      const sourceIds = new Set(latest.proposal.sources.map((s) => s.sourceId));
      const profiles = await getAppDb()
        .select()
        .from(sheetProfile)
        .where(eq(sheetProfile.runId, input.runId));
      const problems = effectProblems(a.effect, sourceIds, {
        sources: profiles.map((p) => ({
          sourceId: p.sourceId,
          fileName: p.fileName,
          sheetName: p.sheetName,
          profile: p.profile as RegionProfile,
        })),
        pack: getPack(input.member.workspace.packId),
      });
      if (problems.length > 0) throw new IngestionRequestError('That change isn’t possible here.');
      corrections.push({ effect: a.effect, label: a.label.slice(0, 300) });
      break;
    }
    case 'undo':
      corrections = corrections.filter((_, i) => i !== a.index);
      break;
    case 'note': {
      const text = a.text.trim();
      if (!text) throw new IngestionRequestError('Please tell us what looks wrong.');
      ownerRequest = text.slice(0, 2_000);
      break;
    }
  }
  await queueJob(input.runId, 'revising', () =>
    input.queue.enqueue(
      ingestReviseJob,
      {
        runId: input.runId,
        fromProposalId: latest.id,
        corrections,
        ...(ownerRequest ? { ownerRequest } : {}),
        userId: input.userId,
      },
      { workspaceId: input.member.workspace.id },
    ),
  );
}

/** "Looks good, set it up". */
export async function approveRun(input: {
  member: MemberWorkspace;
  userId: string;
  runId: string;
  proposalId: string;
  queue: JobQueue;
}): Promise<void> {
  const { latest } = await draftFor(input.member, input.runId, input.proposalId);
  if (!latest.proposal.sources.some((s) => s.decision === 'map'))
    throw new IngestionRequestError('There’s nothing to bring in from these files yet.');
  await queueJob(input.runId, 'applying', () =>
    input.queue.enqueue(
      ingestApplyJob,
      { runId: input.runId, proposalId: latest.id, userId: input.userId },
      { workspaceId: input.member.workspace.id },
    ),
  );
}

/** "Update my data": apply the re-upload with the owner's conflict choices. */
export async function mergeRun(input: {
  member: MemberWorkspace;
  userId: string;
  runId: string;
  resolutions: Record<string, 'mine' | 'theirs'>;
  queue: JobQueue;
}): Promise<void> {
  const run = await getRun(input.member, input.runId);
  if (run.status !== 'merge_review')
    throw new IngestionRequestError('This update isn’t waiting for you any more.');
  const proposal = await latestProposal(run.id);
  if (!proposal) throw new IngestionRequestError('We couldn’t find that import.');
  await queueJob(input.runId, 'merging', () =>
    input.queue.enqueue(
      ingestMergeJob,
      {
        runId: input.runId,
        proposalId: proposal.id,
        resolutions: input.resolutions,
        userId: input.userId,
      },
      { workspaceId: input.member.workspace.id },
    ),
  );
}

/** "Undo this update". */
export async function undoRun(
  member: MemberWorkspace,
  userId: string,
  runId: string,
): Promise<{ edits: number }> {
  await getRun(member, runId);
  try {
    return await undoReupload(runId, userId);
  } catch (err) {
    if (err instanceof ReuploadError || err instanceof UndoError)
      throw new IngestionRequestError(err.message);
    throw err;
  }
}

export async function cancelRun(member: MemberWorkspace, runId: string): Promise<void> {
  const run = await getRun(member, runId);
  if (run.status !== 'review' && run.status !== 'failed' && run.status !== 'merge_review')
    throw new IngestionRequestError('This import can’t be cancelled right now.');
  await getAppDb()
    .update(ingestionRun)
    .set({ status: 'cancelled', updatedAt: new Date(), finishedAt: new Date() })
    .where(eq(ingestionRun.id, run.id));
}
