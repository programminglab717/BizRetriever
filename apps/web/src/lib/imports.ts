import 'server-only';

import type { ProposalReview, RunView } from '@bizr/core/ingestion';
import { renderTemplate, type Segment } from '@bizr/core/narration';
import type { MemberWorkspace } from '@bizr/core/workspaces';
import { getPack } from '@bizr/packs';
import { getEnv, getLogger } from '@bizr/platform';
import { after } from 'next/server';

import { getJobQueue } from './jobs';

/** What the import screens need, as plain JSON (built on the server; the client only renders it). */
export interface ImportView {
  runId: string;
  currency: string;
  status: RunView['run']['status'];
  error: string | null;
  progress: { stage: string; pct: number } | null;
  spotted: string[];
  files: { fileName: string; sizeBytes: number }[];
  proposal: null | {
    id: string;
    version: number;
    summary: Segment[];
    questions: {
      id: string;
      text: string;
      options: { id: string; label: string }[];
      defaultOption: string;
    }[];
    assumptions: { id: string; text: string; confidence: number }[];
    corrections: { index: number; label: string }[];
    changes: string[];
    entities: ProposalReview['entities'];
    skipped: ProposalReview['skipped'];
    ignored: ProposalReview['ignored'];
    warnings: string[];
    spotted: string[];
    aiNote: string | null;
    /** For "This is actually…": the details each record type can have. */
    fieldOptions: Record<string, { key: string; label: string }[]>;
  };
  report: null | {
    entities: { key: string; label: { singular: string; plural: string }; count: number }[];
    skipped: { reason: string; label: string; count: number }[];
    warnings: string[];
    assumptions: string[];
  };
}

export const BUSY_STATUSES: ReadonlySet<string> = new Set(['analyzing', 'revising', 'applying']);

export function toImportView(view: RunView, member: MemberWorkspace): ImportView {
  const p = view.proposal;
  const pack = getPack(member.workspace.packId);
  let proposal: ImportView['proposal'] = null;
  if (p) {
    let summary: Segment[];
    try {
      summary = renderTemplate(p.review.summary.template, p.review.summary.facts, {
        locale: 'en-US',
        currency: member.settings.currency,
      });
    } catch {
      summary = [{ text: 'Here’s what we found in your files.' }];
    }
    const usedEntities = new Set(p.review.entities.map((e) => e.key));
    proposal = {
      id: p.id,
      version: p.version,
      summary,
      questions: p.proposal.questions.map((q) => ({
        id: q.id,
        text: q.text,
        options: q.options.map((o) => ({ id: o.id, label: o.label })),
        defaultOption: q.defaultOption,
      })),
      assumptions: p.proposal.assumptions
        .filter((a) => !a.id.startsWith('you-'))
        .map((a) => ({ id: a.id, text: a.text, confidence: a.confidence })),
      corrections: p.corrections.map((c, index) => ({ index, label: c.label })),
      changes: p.changes,
      entities: p.review.entities,
      skipped: p.review.skipped,
      ignored: p.review.ignored,
      warnings: p.review.warnings,
      spotted: p.review.spotted,
      aiNote: p.review.aiNote ?? null,
      fieldOptions: Object.fromEntries(
        pack.entities
          .filter((e) => usedEntities.has(e.id))
          .map((e) => [
            e.id,
            e.fields.filter((f) => !f.pii).map((f) => ({ key: f.id, label: f.label })),
          ]),
      ),
    };
  }
  const report = view.report as ImportView['report'] | null;
  return {
    runId: view.run.id,
    currency: member.settings.currency,
    status: view.run.status,
    error: view.run.error ?? view.jobError,
    progress: view.progress,
    spotted: view.spotted,
    files: view.files,
    proposal,
    report: report
      ? {
          entities: report.entities,
          skipped: report.skipped,
          warnings: report.warnings,
          assumptions: report.assumptions,
        }
      : null,
  };
}

/**
 * With `JOB_RUNNER=inline` (free hosted preview, e2e tests) there is no worker: process queued jobs
 * after the response is sent, while someone is waiting on them (ARCHITECTURE §11).
 */
export function kickJobs(): void {
  const env = getEnv();
  if (env.JOB_RUNNER !== 'inline') return;
  after(async () => {
    // Polls arrive every couple of seconds; one drain per server process at a time is plenty.
    if (draining) return;
    draining = true;
    try {
      const queue = await getJobQueue();
      await queue.drain({ budgetMs: env.JOB_STEP_BUDGET_MS });
    } catch (err) {
      getLogger('jobs').error({ err }, 'inline drain failed');
    } finally {
      draining = false;
    }
  });
}

let draining = false;
