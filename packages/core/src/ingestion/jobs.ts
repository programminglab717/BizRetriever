import {
  auditEvent,
  getAppDb,
  ingestionRun,
  loadBatch,
  modelProposal,
  qualityReport,
  rowIssue,
  sheetProfile,
} from '@bizr/db';
import { IngestError } from '@bizr/ingest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { getAiProvider } from '../ai/runtime';
import { applyChangePlan, loadCatalog } from '../change-plan/apply';
import { planFromPack } from '../change-plan/from-pack';
import { withTenantWriter } from '../executor/write';
import { defineJob } from '../jobs/define';
import { refreshInsightsStep } from '../insights/jobs';
import { importWebhookStep } from '../platform/jobs';
import { bumpDataVersion, ensureDefaultDashboard } from '../dashboard/service';
import { refreshSemanticCatalog } from '../semantic/service';
import { analyzeTenant } from '../tenancy/provision';
import { proposeDataModel, refineWithDryRun, reviseDataModel } from './ai-proposal';
import { describeChanges } from './changes';
import { applyCorrections, type Correction } from './corrections';
import { dryRunProblems } from './dry-run';
import type { ProfiledSource } from './heuristic';
import { alreadyLoaded, loadOrder, loadRecords } from './load';
import { closeLinkNotes, materialize, type MaterializeResult } from './materialize';
import {
  analyzeRun,
  entitySpecs,
  failRun,
  getProposal,
  latestProposal,
  loadRunContext,
  promptSettings,
  saveProposalVersion,
  type RunContext,
} from './pipeline';
import { proposalSchema, questionEffectSchema, type ModelProposal } from './proposal';
import { buildReview, type ProposalReview } from './review';
import { proposalFacts, summarizeProposal } from './summary';
import { validateTemplate } from '../narration';
import { rememberSources, reuseKnownMappings } from '../merge/service';
import { continueLinkedMerge, continueLinkedReview } from './linked';
import { ingestMergeJob, previewReupload } from './reupload';

/**
 * Ingestion jobs (ARCHITECTURE §11). Each step is idempotent and re-derives what it needs from the
 * stored originals, so a run can stop between steps and resume in a worker or a drain call.
 */

const runInput = z.object({ runId: z.uuid() }).strict();

/** Materialise + review for one proposal (the "test run" the review screen shows). */
async function testProposal(
  ctx: RunContext,
  sources: readonly ProfiledSource[],
  tables: Parameters<typeof materialize>[0],
  proposal: ModelProposal,
  options: {
    spotted: string[];
    aiNote?: string;
    previousTemplate?: string;
    result?: MaterializeResult;
  },
): Promise<ProposalReview> {
  const specs = entitySpecs(ctx.pack);
  const result =
    options.result ?? materialize(tables, proposal, specs, { dateOrder: ctx.settings.dateOrder });
  const facts = proposalFacts(result, proposal, ctx.pack, ctx.uploads.length);
  // Re-use the previous wording when it still fits the facts (no AI call for every correction).
  const summary =
    options.previousTemplate &&
    validateTemplate(options.previousTemplate, Object.keys(facts.facts)).length === 0
      ? { template: options.previousTemplate, origin: 'ai' as const }
      : await summarizeProposal(facts, proposal, {
          provider: getAiProvider(),
          workspaceId: ctx.workspace.id,
        });
  return buildReview({
    result,
    proposal,
    specs,
    pack: ctx.pack,
    sources,
    summary: { ...summary, facts: facts.facts },
    problems: dryRunProblems(result),
    spotted: options.spotted,
    ...(options.aiNote ? { aiNote: options.aiNote } : {}),
  });
}

interface AnalyzeState {
  failed?: boolean;
  proposal?: ModelProposal;
  origin?: 'ai' | 'heuristic';
  spotted?: string[];
  aiNote?: string;
}

/** Upload → "Here's what we found": read files, propose a model, test it on every line. */
export const ingestAnalyzeJob = defineJob<z.infer<typeof runInput>, AnalyzeState>({
  name: 'ingest.analyze',
  input: runInput,
  initialState: () => ({}),
  failureMessage: 'Something went wrong while reading your files. Please try uploading them again.',
  steps: [
    {
      name: 'read',
      async run({ input, state, reportProgress }) {
        await reportProgress('Reading your files', 5);
        const ctx = await loadRunContext(input.runId);
        try {
          const analysis = await analyzeRun(ctx);
          if (analysis.profiled.length === 0) {
            await failRun(ctx.run.id, 'We couldn’t find any information in these files.');
            return { state: { ...state, failed: true } };
          }
          await getAppDb().transaction(async (tx) => {
            await tx.delete(sheetProfile).where(eq(sheetProfile.runId, ctx.run.id));
            await tx.insert(sheetProfile).values(
              analysis.profiled.map((p) => ({
                runId: ctx.run.id,
                sourceId: p.sourceId,
                uploadId: ctx.uploads[Number(/^f(\d+):/.exec(p.sourceId)![1])]!.id,
                fileName: p.fileName,
                sheetName: p.sheetName,
                profile: p.profile,
              })),
            );
          });
        } catch (err) {
          if (err instanceof IngestError) {
            await failRun(ctx.run.id, err.userMessage);
            return { state: { ...state, failed: true } };
          }
          throw err;
        }
        return { state };
      },
    },
    {
      name: 'propose',
      async run({ input, state, reportProgress }) {
        if (state.failed || state.proposal) return { state };
        await reportProgress('Working out what everything is', 25);
        const ctx = await loadRunContext(input.runId);
        const analysis = await analyzeRun(ctx);
        const out = await proposeDataModel(analysis.profiled, {
          pack: ctx.pack,
          settings: promptSettings(ctx),
          provider: getAiProvider(),
          workspaceId: ctx.workspace.id,
        });
        // A re-upload: sheets we've seen before keep the mapping the owner approved (ADR-043).
        const reused =
          ctx.run.kind === 'reupload'
            ? await reuseKnownMappings(ctx.workspace.id, analysis.profiled, out.proposal)
            : undefined;
        return {
          state: {
            ...state,
            proposal: reused?.proposal ?? out.proposal,
            origin: out.origin,
            spotted: [
              ...(reused?.matches ?? []).map(
                (m) => `This looks like a newer version of “${m.label}”.`,
              ),
              ...out.spotted,
            ],
            ...(out.userNote ? { aiNote: out.userNote } : {}),
          },
        };
      },
    },
    {
      name: 'test',
      async run({ input, state, reportProgress }) {
        if (state.failed || !state.proposal) return { state };
        await reportProgress('Checking every line', 60);
        const ctx = await loadRunContext(input.runId);
        if (await latestProposal(ctx.run.id)) return { state };
        const analysis = await analyzeRun(ctx);
        const specs = entitySpecs(ctx.pack);
        const refined = await refineWithDryRun(
          proposalSchema.parse(state.proposal),
          analysis.profiled,
          {
            pack: ctx.pack,
            settings: promptSettings(ctx),
            provider: getAiProvider(),
            workspaceId: ctx.workspace.id,
          },
          (p) => materialize(analysis.tables, p, specs, { dateOrder: ctx.settings.dateOrder }),
        );
        await reportProgress('Writing up what we found', 90);
        const review = await testProposal(
          ctx,
          analysis.profiled,
          analysis.tables,
          refined.proposal,
          {
            spotted: state.spotted ?? [],
            ...(state.aiNote ? { aiNote: state.aiNote } : {}),
            result: refined.result,
          },
        );
        await saveProposalVersion({
          ctx,
          version: 1,
          origin: state.origin ?? 'heuristic',
          baseProposal: refined.proposal,
          corrections: [],
          proposal: refined.proposal,
          review,
          changes: refined.changes,
        });
        await reportProgress('Ready for you to check', 100);
        return { state: { ...state, proposal: undefined } };
      },
    },
    {
      // From a linked source: carry on by itself when nothing needs a person (ADR-058).
      name: 'continue',
      async run({ input, state, enqueue }) {
        if (state.failed) return { state };
        await continueLinkedReview(input.runId, enqueue, ingestApplyJob);
        return { state };
      },
    },
  ],
});

const correctionSchema = z
  .object({
    effect: questionEffectSchema,
    label: z.string().max(400),
    questionId: z.string().max(40).optional(),
  })
  .strict();

const reviseInput = z
  .object({
    runId: z.uuid(),
    fromProposalId: z.uuid(),
    corrections: z.array(correctionSchema).max(100),
    ownerRequest: z.string().max(2_000).optional(),
    userId: z.string().optional(),
  })
  .strict();

/** A correction on the review screen: apply it (and the owner's words, via the AI), test again. */
export const ingestReviseJob = defineJob<z.infer<typeof reviseInput>, Record<string, never>>({
  name: 'ingest.revise',
  input: reviseInput,
  initialState: () => ({}),
  failureMessage: 'We couldn’t apply that change. Please try again.',
  steps: [
    {
      name: 'revise',
      async run({ input, state, reportProgress }) {
        await reportProgress('Updating', 20);
        const ctx = await loadRunContext(input.runId);
        const from = await getProposal(ctx.run.id, input.fromProposalId);
        const latest = await latestProposal(ctx.run.id);
        if (!from || !latest) throw new Error('proposal not found');
        if (latest.id !== from.id) return { state }; // already done (re-run) or superseded
        const corrections = input.corrections as Correction[];
        const analysis = await analyzeRun(ctx);

        let base = from.baseProposal;
        let proposal = applyCorrections(base, corrections, ctx.pack);
        let changes: string[] = [];
        let aiNote: string | undefined;
        if (input.ownerRequest) {
          await reportProgress('Reading your note', 40);
          const revision = await reviseDataModel(
            {
              proposal: base,
              sources: analysis.profiled,
              ownerRequest: input.ownerRequest,
              corrections,
            },
            {
              pack: ctx.pack,
              settings: promptSettings(ctx),
              provider: getAiProvider(),
              workspaceId: ctx.workspace.id,
            },
          );
          if (revision.revised) {
            base = revision.proposal;
            proposal = revision.proposal;
            changes = revision.changes;
          } else {
            aiNote = revision.userNote;
          }
        }
        if (changes.length === 0)
          changes = describeChanges(from.proposal, proposal, analysis.profiled, ctx.pack);

        await reportProgress('Checking every line', 70);
        const review = await testProposal(ctx, analysis.profiled, analysis.tables, proposal, {
          spotted: from.review.spotted,
          previousTemplate: from.review.summary.template,
          ...(aiNote ? { aiNote } : {}),
        });
        await saveProposalVersion({
          ctx,
          version: from.version + 1,
          origin: from.origin,
          baseProposal: base,
          corrections,
          proposal,
          review,
          changes,
          userId: input.userId ?? null,
        });
        await reportProgress('Updated', 100);
        return { state };
      },
    },
  ],
});

const applyInput = z
  .object({ runId: z.uuid(), proposalId: z.uuid(), userId: z.string().optional() })
  .strict();

/** "Looks good, set it up": create the record types, load the records, write the quality report. */
export const ingestApplyJob = defineJob<z.infer<typeof applyInput>, Record<string, never>>({
  name: 'ingest.apply',
  input: applyInput,
  initialState: () => ({}),
  failureMessage: 'Something went wrong while setting up your data. Nothing was changed.',
  steps: [
    {
      name: 'structure',
      async run({ input, state, reportProgress }) {
        await reportProgress('Setting up your records', 10);
        const ctx = await loadRunContext(input.runId);
        const stored = await getProposal(ctx.run.id, input.proposalId);
        if (!stored) throw new Error('proposal not found');
        const used = [
          ...new Set(stored.proposal.sources.flatMap((s) => s.targets.map((t) => t.entity))),
        ];
        if (used.length === 0) return { state };
        const existing = new Set((await loadCatalog(ctx.workspace.id)).map((e) => e.key));
        const ops = planFromPack(ctx.pack, used).ops.filter(
          (o) => !(o.op === 'create_entity' && existing.has(o.key)),
        );
        if (ops.length > 0) {
          await applyChangePlan({
            workspace: { id: ctx.workspace.id, tenantSchema: ctx.workspace.tenantSchema },
            plan: { ops },
            origin: 'ingestion',
            userId: input.userId ?? null,
          });
        }
        return { state };
      },
    },
    {
      name: 'load',
      async run({ input, state, reportProgress }) {
        await reportProgress('Bringing in your records', 40);
        const ctx = await loadRunContext(input.runId);
        if (ctx.run.kind === 'reupload') {
          // Nothing is written yet: work out what would change and ask the owner (merge preview).
          await reportProgress('Comparing with your records', 60);
          await previewReupload(ctx, input.proposalId);
          await reportProgress('Ready for you to check', 100);
          return { state };
        }
        const stored = await getProposal(ctx.run.id, input.proposalId);
        if (!stored) throw new Error('proposal not found');
        const analysis = await analyzeRun(ctx);
        const specs = entitySpecs(ctx.pack);
        const result = materialize(analysis.tables, stored.proposal, specs, {
          dateOrder: ctx.settings.dateOrder,
        });
        const catalog = await loadCatalog(ctx.workspace.id);
        const uploadIds = ctx.uploads.map((u) => u.id);
        const keys = [...result.entities.keys()].filter(
          (k) => (result.entities.get(k)?.length ?? 0) > 0,
        );

        const stats = await withTenantWriter(
          { workspaceId: ctx.workspace.id, tenantSchema: ctx.workspace.tenantSchema },
          `ingest.apply load run=${ctx.run.id}`,
          async (writer) => {
            if (await alreadyLoaded(writer, catalog, loadOrder(catalog, keys), uploadIds))
              return null;
            return loadRecords(writer, catalog, result, uploadIds);
          },
          { timezone: ctx.settings.timezone },
        );

        await rememberSources(
          ctx.workspace.id,
          ctx.run.id,
          stored.proposal,
          analysis.profiled,
          (sourceId) => ctx.uploads[Number(/^f(\d+):/.exec(sourceId)?.[1] ?? 0)]!.id,
        );

        await reportProgress('Working out what we can measure', 80);
        await analyzeTenant(ctx.workspace.tenantSchema);
        await refreshSemanticCatalog({
          id: ctx.workspace.id,
          tenantSchema: ctx.workspace.tenantSchema,
          packId: ctx.workspace.packId,
        });
        // New records: cached dashboard tiles are stale, and new tiles may now be possible.
        await bumpDataVersion(ctx.workspace.id);
        await ensureDefaultDashboard(
          { id: ctx.workspace.id, packId: ctx.workspace.packId },
          input.userId ?? null,
        );
        await reportProgress('Writing your data quality report', 85);
        const db = getAppDb();
        await db.transaction(async (tx) => {
          if (stats) {
            await tx.delete(loadBatch).where(eq(loadBatch.runId, ctx.run.id));
            for (const s of stats) {
              const e = result.stats.entities[s.entity];
              await tx.insert(loadBatch).values({
                runId: ctx.run.id,
                workspaceId: ctx.workspace.id,
                entityKey: s.entity,
                rowsIn: s.rowsIn,
                inserted: s.inserted,
                merged: e?.merged ?? 0,
                skipped: e?.dropped ?? 0,
                flagged: result.issues.filter((i) => i.entity === s.entity).length,
              });
            }
            await tx.delete(rowIssue).where(eq(rowIssue.runId, ctx.run.id));
            const issues = [
              ...result.issues.map((i) => ({
                entityKey: i.entity,
                fieldKey: i.field ?? null,
                code: i.code,
                fileName: i.fileName,
                sheetName: i.sheet,
                sheetRow: i.row,
                message: i.message,
              })),
              ...result.skipped
                .filter((s) => ['totals', 'blank', 'note', 'rule'].includes(s.reason))
                .map((s) => ({
                  entityKey: null,
                  fieldKey: null,
                  code: `skipped_${s.reason}`,
                  fileName: s.fileName,
                  sheetName: s.sheet,
                  sheetRow: s.sheetRow,
                  message: s.detail.slice(0, 300),
                })),
            ].slice(0, 5_000);
            for (let i = 0; i < issues.length; i += 500) {
              await tx
                .insert(rowIssue)
                .values(
                  issues
                    .slice(i, i + 500)
                    .map((x) => ({ ...x, runId: ctx.run.id, workspaceId: ctx.workspace.id })),
                );
            }
          }
          const report = {
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
            action: 'ingestion.applied',
            details: { runId: ctx.run.id, proposalId: stored.id, version: stored.version },
          });
        });
        await reportProgress('Done', 100);
        return { state };
      },
    },
    {
      // A linked source's update with nothing to settle is applied without asking (ADR-058).
      name: 'continue',
      async run({ input, state, enqueue }) {
        await continueLinkedMerge(input.runId, enqueue, ingestMergeJob);
        return { state };
      },
    },
    importWebhookStep(),
    refreshInsightsStep('import'),
  ],
});

export const ingestionJobs = [
  ingestAnalyzeJob,
  ingestReviseJob,
  ingestApplyJob,
  ingestMergeJob,
] as const;
