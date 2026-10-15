import {
  getAppDb,
  getStorage,
  ingestionRun,
  modelProposal,
  upload,
  workspace,
  workspaceSettings,
  type IngestionRun,
  type ModelProposalRow,
  type Upload,
  type Workspace,
  type WorkspaceSettings as SettingsRow,
} from '@bizr/db';
import type { WorkspaceSettings } from '@bizr/ai/prompts';
import { getPack, type PackData } from '@bizr/packs';
import { and, asc, desc, eq, ne } from 'drizzle-orm';

import { planFromPack } from '../change-plan/from-pack';
import { analyzeFiles, type Analysis } from './analyze';
import type { Correction } from './corrections';
import type { EntitySpec } from './materialize';
import type { ModelProposal } from './proposal';
import type { ProposalReview } from './review';

/** Shared plumbing for the ingestion jobs and service: loading a run and its files. */

export interface RunContext {
  run: IngestionRun;
  workspace: Workspace;
  settings: SettingsRow;
  uploads: Upload[];
  pack: PackData;
}

export async function loadRunContext(runId: string): Promise<RunContext> {
  const db = getAppDb();
  const [row] = await db
    .select({ run: ingestionRun, workspace, settings: workspaceSettings })
    .from(ingestionRun)
    .innerJoin(workspace, eq(workspace.id, ingestionRun.workspaceId))
    .innerJoin(workspaceSettings, eq(workspaceSettings.workspaceId, workspace.id))
    .where(eq(ingestionRun.id, runId));
  if (!row) throw new Error(`Ingestion run ${runId} not found`);
  const uploads = await db
    .select()
    .from(upload)
    .where(eq(upload.runId, runId))
    .orderBy(asc(upload.position));
  return { ...row, uploads, pack: getPack(row.workspace.packId) };
}

/** Today's date (YYYY-MM-DD) in the workspace's time zone. */
export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function promptSettings(ctx: RunContext): WorkspaceSettings {
  return {
    currency: ctx.settings.currency,
    dateOrder: ctx.settings.dateOrder,
    today: todayIn(ctx.settings.timezone, ctx.run.createdAt),
  };
}

/** Parse → tables → profiles for the run's files (deterministic, so safe to repeat in any step). */
export async function analyzeRun(ctx: RunContext): Promise<Analysis> {
  const storage = getStorage();
  const files = await Promise.all(
    ctx.uploads.map(async (u) => ({
      fileName: u.fileName,
      uploadId: u.id,
      bytes: await storage.get(u.storageKey),
    })),
  );
  return analyzeFiles(files, {
    dateOrder: ctx.settings.dateOrder,
    maskPii: ctx.settings.piiMasking,
  });
}

/** Every record type of the pack, in creation order, as the materialiser needs them. */
export function entitySpecs(pack: PackData): EntitySpec[] {
  return planFromPack(
    pack,
    pack.entities.map((e) => e.id),
  ).ops.flatMap((o) =>
    o.op === 'create_entity'
      ? [{ key: o.key, label: o.label, fields: o.fields, naturalKeys: o.naturalKeys }]
      : [],
  );
}

export interface StoredProposal extends Omit<
  ModelProposalRow,
  'baseProposal' | 'proposal' | 'corrections' | 'review' | 'changes'
> {
  baseProposal: ModelProposal;
  proposal: ModelProposal;
  corrections: Correction[];
  review: ProposalReview;
  changes: string[];
}

export async function latestProposal(runId: string): Promise<StoredProposal | undefined> {
  const [row] = await getAppDb()
    .select()
    .from(modelProposal)
    .where(eq(modelProposal.runId, runId))
    .orderBy(desc(modelProposal.version))
    .limit(1);
  return row as StoredProposal | undefined;
}

export async function getProposal(
  runId: string,
  proposalId: string,
): Promise<StoredProposal | undefined> {
  const [row] = await getAppDb()
    .select()
    .from(modelProposal)
    .where(and(eq(modelProposal.runId, runId), eq(modelProposal.id, proposalId)));
  return row as StoredProposal | undefined;
}

/**
 * Saves a new proposal version (idempotent per `version`) and moves the run to review. Older drafts
 * are marked superseded.
 */
export async function saveProposalVersion(input: {
  ctx: RunContext;
  version: number;
  origin: 'ai' | 'heuristic';
  baseProposal: ModelProposal;
  corrections: readonly Correction[];
  proposal: ModelProposal;
  review: ProposalReview;
  changes: readonly string[];
  userId?: string | null;
}): Promise<void> {
  const { ctx } = input;
  await getAppDb().transaction(async (tx) => {
    await tx
      .insert(modelProposal)
      .values({
        runId: ctx.run.id,
        workspaceId: ctx.workspace.id,
        version: input.version,
        origin: input.origin,
        baseProposal: input.baseProposal,
        corrections: input.corrections,
        proposal: input.proposal,
        review: input.review,
        changes: input.changes,
        createdBy: input.userId ?? null,
      })
      .onConflictDoNothing();
    await tx
      .update(modelProposal)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(modelProposal.runId, ctx.run.id),
          ne(modelProposal.version, input.version),
          eq(modelProposal.status, 'draft'),
        ),
      );
    await tx
      .update(ingestionRun)
      .set({ status: 'review', updatedAt: new Date() })
      .where(eq(ingestionRun.id, ctx.run.id));
  });
}

export async function failRun(runId: string, userMessage: string): Promise<void> {
  await getAppDb()
    .update(ingestionRun)
    .set({ status: 'failed', error: userMessage, updatedAt: new Date(), finishedAt: new Date() })
    .where(eq(ingestionRun.id, runId));
}
