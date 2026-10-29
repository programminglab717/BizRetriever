import {
  auditEvent,
  getAppDb,
  ingestionRun,
  loadBatch,
  mergePreview,
  modelProposal,
  qualityReport,
} from '@bizr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { loadCatalog } from '../change-plan/apply';
import { bumpDataVersion, ensureDefaultDashboard } from '../dashboard/service';
import { withTenantWriter } from '../executor/write';
import { defineJob } from '../jobs/define';
import { refreshInsightsStep } from '../insights/jobs';
import { importWebhookStep } from '../platform/jobs';
import {
  applyUpload,
  diffUpload,
  previewOf,
  rememberSources,
  reuseKnownMappings,
  uploadsOfMatchedSources,
  type MergePreview,
} from '../merge/service';
import { ensureEditLog, undoBatch } from '../records/edits';
import { refreshSemanticCatalog } from '../semantic/service';
import { rememberConverted } from '../currency/rates';
import { analyzeTenant } from '../tenancy/provision';
import type { MaterializedRecord } from './materialize';
import { closeLinkNotes } from './materialize';
import {
  analyzeRun,
  getProposal,
  loadRunContext,
  materializeRun,
  type RunContext,
} from './pipeline';

/**
 * Re-upload (ADR-043): after review, the new files are diffed against the records already there
 * (merge preview); the owner settles conflicts and applies; the update can be undone as a whole.
 */

const uploadIdOf = (ctx: RunContext) => (sourceId: string) =>
  ctx.uploads[Number(/^f(\d+):/.exec(sourceId)?.[1] ?? -1)]?.id ?? ctx.uploads[0]!.id;
const recordUpload = (ctx: RunContext) => (r: MaterializedRecord) =>
  r.lineage[0] ? uploadIdOf(ctx)(r.lineage[0].sourceId) : null;

async function prepared(ctx: RunContext, proposalId: string) {
  const stored = await getProposal(ctx.run.id, proposalId);
  if (!stored) throw new Error('proposal not found');
  const analysis = await analyzeRun(ctx);
  const { result, conversion } = await materializeRun(ctx, analysis.tables, stored.proposal);
  const { matches } = await reuseKnownMappings(
    ctx.workspace.id,
    analysis.profiled,
    stored.proposal,
  );
  const scope = new Set(await uploadsOfMatchedSources(ctx.workspace.id, matches));
  return { stored, analysis, result, conversion, matches, scope };
}

/** Builds and stores the merge preview, and hands the run back to the owner (`merge_review`). */
export async function previewReupload(ctx: RunContext, proposalId: string): Promise<MergePreview> {
  const { result, matches, scope } = await prepared(ctx, proposalId);
  const catalog = await loadCatalog(ctx.workspace.id);
  await ensureEditLog(ctx.workspace.tenantSchema);
  const diffs = await withTenantWriter(
    { workspaceId: ctx.workspace.id, tenantSchema: ctx.workspace.tenantSchema },
    `merge.diff run=${ctx.run.id}`,
    (writer) => diffUpload(writer, catalog, result, scope),
    { timezone: ctx.settings.timezone },
  );
  const preview = previewOf(diffs, matches);
  const db = getAppDb();
  await db.transaction(async (tx) => {
    await tx
      .insert(mergePreview)
      .values({ runId: ctx.run.id, workspaceId: ctx.workspace.id, preview })
      .onConflictDoUpdate({ target: mergePreview.runId, set: { preview } });
    await tx
      .update(ingestionRun)
      .set({ status: 'merge_review', updatedAt: new Date() })
      .where(eq(ingestionRun.id, ctx.run.id));
  });
  return preview;
}

const mergeInput = z
  .object({
    runId: z.uuid(),
    proposalId: z.uuid(),
    /** `<record id>:<field>` → keep the owner's value or take the file's. */
    resolutions: z.record(z.string().max(80), z.enum(['mine', 'theirs'])),
    userId: z.string().optional(),
  })
  .strict();

/** "Update my data": inserts and updates only, logged as one batch (the run id) for undo. */
export const ingestMergeJob = defineJob<z.infer<typeof mergeInput>, Record<string, never>>({
  name: 'ingest.merge',
  input: mergeInput,
  initialState: () => ({}),
  failureMessage: 'Something went wrong while updating your data. Nothing was changed.',
  steps: [
    {
      name: 'merge',
      async run({ input, state, reportProgress }) {
        await reportProgress('Updating your records', 30);
        const ctx = await loadRunContext(input.runId);
        if (ctx.run.status === 'done') return { state }; // already merged (step re-run)
        const { stored, analysis, result, conversion, scope } = await prepared(
          ctx,
          input.proposalId,
        );
        const catalog = await loadCatalog(ctx.workspace.id);
        await ensureEditLog(ctx.workspace.tenantSchema);
        const stats = await withTenantWriter(
          { workspaceId: ctx.workspace.id, tenantSchema: ctx.workspace.tenantSchema },
          `merge.apply run=${ctx.run.id}`,
          async (writer) => {
            // Idempotent: a batch already written for this run means the merge already happened.
            const done = await writer.query(
              'SELECT 1 FROM _record_edit WHERE batch_id = $1 LIMIT 1',
              [ctx.run.id],
            );
            if (done.rows.length) return null;
            return applyUpload(writer, catalog, result, scope, {
              batchId: ctx.run.id,
              userId: input.userId ?? null,
              resolutions: input.resolutions,
              uploadIdFor: recordUpload(ctx),
            });
          },
          { timezone: ctx.settings.timezone },
        );
        await rememberSources(
          ctx.workspace.id,
          ctx.run.id,
          stored.proposal,
          analysis.profiled,
          uploadIdOf(ctx),
        );

        if (stats) await rememberConverted(ctx.workspace.id, conversion);
        await reportProgress('Working out what we can measure', 80);
        await afterDataChange(ctx, input.userId ?? null);
        const db = getAppDb();
        await db.transaction(async (tx) => {
          if (stats) {
            await tx.delete(loadBatch).where(eq(loadBatch.runId, ctx.run.id));
            for (const s of stats)
              await tx.insert(loadBatch).values({
                runId: ctx.run.id,
                workspaceId: ctx.workspace.id,
                entityKey: s.entity,
                rowsIn: result.entities.get(s.entity)?.length ?? 0,
                inserted: s.inserted,
                merged: s.updated,
                skipped: 0,
                flagged: result.issues.filter((i) => i.entity === s.entity).length,
              });
          }
          const report = {
            kind: 'reupload' as const,
            merge: stats ?? [],
            entities: stored.review.entities.map((e) => ({
              key: e.key,
              label: e.label,
              count: result.entities.get(e.key)?.length ?? 0,
              merged: e.merged,
            })),
            skipped: stored.review.skipped.map((s) => ({
              reason: s.reason,
              label: s.label,
              count: s.count,
            })),
            unreadable: result.issues.filter((i) => i.code === 'unreadable_value').length,
            missingRequired: result.issues.filter((i) => i.code === 'missing_required').length,
            links: result.stats.references,
            warnings: stored.review.warnings,
            assumptions: [
              ...stored.proposal.assumptions.map((a) => a.text),
              ...closeLinkNotes(result),
            ],
          };
          await tx
            .insert(qualityReport)
            .values({ runId: ctx.run.id, workspaceId: ctx.workspace.id, report })
            .onConflictDoUpdate({ target: qualityReport.runId, set: { report } });
          await tx
            .update(modelProposal)
            .set({ status: 'approved' })
            .where(eq(modelProposal.id, stored.id));
          await tx
            .update(ingestionRun)
            .set({ status: 'done', updatedAt: new Date(), finishedAt: new Date() })
            .where(eq(ingestionRun.id, ctx.run.id));
          await tx.insert(auditEvent).values({
            workspaceId: ctx.workspace.id,
            userId: input.userId ?? null,
            action: 'ingestion.merged',
            details: { runId: ctx.run.id, stats: stats ?? [] },
          });
        });
        await reportProgress('Done', 100);
        return { state };
      },
    },
    importWebhookStep(),
    refreshInsightsStep('reupload'),
  ],
});

/** New or changed records: statistics, measures, cached tiles and possible new tiles. */
async function afterDataChange(ctx: RunContext, userId: string | null) {
  await analyzeTenant(ctx.workspace.tenantSchema);
  await refreshSemanticCatalog({
    id: ctx.workspace.id,
    tenantSchema: ctx.workspace.tenantSchema,
    packId: ctx.workspace.packId,
  });
  await bumpDataVersion(ctx.workspace.id);
  await ensureDefaultDashboard({ id: ctx.workspace.id, packId: ctx.workspace.packId }, userId);
}

export class ReuploadError extends Error {}

/** "Undo this update": new records are hidden (never removed) and changed fields get their old values. */
export async function undoReupload(
  runId: string,
  userId: string | null,
): Promise<{ edits: number }> {
  const ctx = await loadRunContext(runId);
  if (ctx.run.kind !== 'reupload' || ctx.run.status !== 'done')
    throw new ReuploadError('Only finished updates can be undone.');
  if (ctx.run.undoneAt) throw new ReuploadError('This update was already undone.');
  await ensureEditLog(ctx.workspace.tenantSchema);
  const r = await withTenantWriter(
    { workspaceId: ctx.workspace.id, tenantSchema: ctx.workspace.tenantSchema },
    `merge.undo run=${runId}`,
    (writer) => undoBatch(writer, runId),
    { timezone: ctx.settings.timezone },
  );
  const db = getAppDb();
  await db
    .update(ingestionRun)
    .set({ undoneAt: new Date(), updatedAt: new Date() })
    .where(eq(ingestionRun.id, runId));
  await db.insert(auditEvent).values({
    workspaceId: ctx.workspace.id,
    userId,
    action: 'ingestion.merge_undone',
    details: { runId, edits: r.edits },
  });
  await afterDataChange(ctx, userId);
  return r;
}

export async function getMergePreview(runId: string): Promise<MergePreview | undefined> {
  const [row] = await getAppDb().select().from(mergePreview).where(eq(mergePreview.runId, runId));
  return row?.preview as MergePreview | undefined;
}
