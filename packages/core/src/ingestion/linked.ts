import { connection, getAppDb, ingestionRun } from '@bizr/db';
import { getLogger } from '@bizr/platform';
import { and, eq, ne } from 'drizzle-orm';

import type { JobDefinition, JobEnqueuer } from '../jobs/define';
import { reuseKnownMappings } from '../merge/service';
import { analyzeRun, latestProposal, loadRunContext } from './pipeline';
import type { ModelProposal } from './proposal';
import { getMergePreview } from './reupload';
import { queueJob } from './service';

/**
 * Imports from a linked source (M10, ADR-058) carry on by themselves when nothing needs a person:
 * every sheet is one we've seen (same headers, approved mapping), there are no questions, and the
 * update doesn't touch anything the owner changed by hand. Otherwise the run waits, as an upload
 * would, and the owner is told it needs a look. A first import from a source always waits.
 */

const log = () => getLogger('linked-import');

/**
 * A question every answer of which only adjusts a sheet we recognise (its date order, a column) was
 * settled when the owner approved that sheet's mapping, which is reused as it is. Anything else
 * (whether two spellings are one customer) still needs the owner.
 */
export function settledByMapping(
  q: ModelProposal['questions'][number],
  known: ReadonlySet<string>,
) {
  return q.options.every(({ effect: e }) => {
    switch (e.kind) {
      case 'none':
        return true;
      case 'set_date_order':
        return e.sourceIds.every((id) => known.has(id));
      case 'set_rules':
      case 'ignore_source':
      case 'unmap_field':
      case 'map_column':
        return known.has(e.sourceId);
      default:
        return false;
    }
  });
}

async function linkedRun(runId: string) {
  const db = getAppDb();
  const [run] = await db.select().from(ingestionRun).where(eq(ingestionRun.id, runId));
  if (!run?.connectionId) return null;
  const [conn] = await db.select().from(connection).where(eq(connection.id, run.connectionId));
  if (!conn) return null;
  // The owner sees a source's first import through, review and changes alike.
  const [before] = await db
    .select({ id: ingestionRun.id })
    .from(ingestionRun)
    .where(
      and(
        eq(ingestionRun.connectionId, conn.id),
        eq(ingestionRun.status, 'done'),
        ne(ingestionRun.id, run.id),
      ),
    )
    .limit(1);
  return {
    run,
    conn,
    automatic: Boolean(before) && conn.autoUpdate && conn.status === 'active',
  };
}

/** After analysis: approve a recognised re-import ("Looks good, compare with my data"). */
export async function continueLinkedReview(
  runId: string,
  enqueue: JobEnqueuer,
  applyJob: JobDefinition<{ runId: string; proposalId: string; userId?: string }, unknown>,
): Promise<'continued' | 'waiting' | 'not_linked'> {
  const linked = await linkedRun(runId);
  if (!linked) return 'not_linked';
  const { run, automatic } = linked;
  if (run.status !== 'review') return run.status === 'applying' ? 'continued' : 'waiting';
  const wait = (reason: string) => {
    log().info({ runId, reason }, 'linked import waits for the owner');
    return 'waiting' as const;
  };
  if (!automatic) return wait('first import, or automatic updates off');
  if (run.kind !== 'reupload') return wait('first import into this business');
  const latest = await latestProposal(runId);
  if (!latest) return wait('no proposal');
  const mapped = latest.proposal.sources.filter((s) => s.decision === 'map');
  if (mapped.length === 0) return wait('nothing to bring in');
  const ctx = await loadRunContext(runId);
  const analysis = await analyzeRun(ctx);
  const { matches } = await reuseKnownMappings(
    ctx.workspace.id,
    analysis.profiled,
    latest.proposal,
  );
  const known = new Set(matches.map((m) => m.sourceId));
  if (!mapped.every((m) => known.has(m.sourceId))) return wait('a sheet we haven’t seen before');
  const open = latest.proposal.questions.filter((q) => !settledByMapping(q, known));
  if (open.length > 0) return wait(`questions to answer: ${open.map((q) => q.id).join(', ')}`);
  await queueJob(runId, 'applying', () =>
    enqueue(
      applyJob,
      { runId, proposalId: latest.id, ...(run.createdBy ? { userId: run.createdBy } : {}) },
      { workspaceId: run.workspaceId },
    ),
  );
  log().info({ runId }, 'linked import: recognised, comparing');
  return 'continued';
}

/** After the comparison: apply it when nothing conflicts with the owner's own changes. */
export async function continueLinkedMerge(
  runId: string,
  enqueue: JobEnqueuer,
  mergeJob: JobDefinition<
    {
      runId: string;
      proposalId: string;
      resolutions: Record<string, 'mine' | 'theirs'>;
      userId?: string;
    },
    unknown
  >,
): Promise<'continued' | 'waiting' | 'not_linked'> {
  const linked = await linkedRun(runId);
  if (!linked) return 'not_linked';
  const { run, automatic } = linked;
  if (run.status !== 'merge_review') return run.status === 'merging' ? 'continued' : 'waiting';
  if (!automatic) return 'waiting';
  const preview = await getMergePreview(runId);
  const latest = await latestProposal(runId);
  if (!preview || !latest || preview.entities.some((e) => e.conflicts.length > 0)) {
    log().info({ runId }, 'linked import waits: changes clash with the owner’s own');
    return 'waiting';
  }
  await queueJob(runId, 'merging', () =>
    enqueue(
      mergeJob,
      {
        runId,
        proposalId: latest.id,
        resolutions: {},
        ...(run.createdBy ? { userId: run.createdBy } : {}),
      },
      { workspaceId: run.workspaceId },
    ),
  );
  log().info({ runId }, 'linked import: no conflicts, updating');
  return 'continued';
}
