import {
  auditEvent,
  connection,
  getAppDb,
  ingestionRun,
  workspace,
  type ConnectionKind,
  type ConnectionStatus,
} from '@bizr/db';
import { getLogger } from '@bizr/platform';
import { and, desc, eq, inArray, isNull, lt, notInArray, or } from 'drizzle-orm';

import { IngestionRequestError, startIngestion, type IncomingFile } from '../ingestion/service';
import type { JobEnqueuer } from '../jobs/define';
import { getMemberWorkspace, type MemberWorkspace } from '../workspaces/service';
import { SourceError } from './fetch';
import { contentFingerprint } from './fingerprint';
import { externalIdOf, fetchSheet, parseSheetLink, refOf } from './sheets';

/**
 * Linked sources (M10, ADR-058). Linking fetches once and starts an ordinary import, which the owner
 * reviews like an upload. After that, `syncConnection` (daily, or "Update now") fetches again: the
 * same contents do nothing; new contents start an import that carries on by itself when nothing
 * needs a person (`ingestion/linked.ts`).
 */

const log = () => getLogger('connections');

export class ConnectionError extends Error {}

type Connection = typeof connection.$inferSelect;

/** Statuses of an import still in progress or waiting for the owner. */
const UNFINISHED = ['done', 'failed', 'cancelled'] as const;
/** Two checks of one source at least this far apart ("Update now" pressed twice, daily + manual). */
const MIN_CHECK_INTERVAL_MS = 60_000;

export interface Fetched {
  name: string;
  files: IncomingFile[];
}

/** What a connection holds now. Shopify is added by `registerFetcher` (see `shopify/`). */
const fetchers = new Map<ConnectionKind, (c: Connection) => Promise<Fetched>>([
  [
    'google_sheet',
    async (c) => {
      const sheet = await fetchSheet(refOf(c.externalId));
      return { name: sheet.title, files: [sheet.file] };
    },
  ],
]);

export function registerFetcher(
  kind: ConnectionKind,
  fetcher: (c: Connection) => Promise<Fetched>,
): void {
  fetchers.set(kind, fetcher);
}

async function fetchConnection(c: Connection): Promise<Fetched> {
  const f = fetchers.get(c.kind);
  if (!f) throw new SourceError('This kind of source isn’t available here.', 'needs_attention');
  return f(c);
}

function friendly(err: unknown): string {
  if (err instanceof SourceError || err instanceof IngestionRequestError) return err.message;
  return 'Something went wrong while checking this source. We’ll try again later.';
}

/** "Link a Google Sheet": fetch it now, remember it, and start its first import. */
export async function linkGoogleSheet(input: {
  member: MemberWorkspace;
  userId: string;
  link: string;
  queue: { enqueue: JobEnqueuer };
}): Promise<{ connectionId: string; runId: string }> {
  const ws = input.member.workspace;
  const ref = parseSheetLink(input.link);
  if (!ref)
    throw new ConnectionError(
      'That doesn’t look like a Google Sheets link. Open the sheet, choose Share → Copy link, and paste it here.',
    );
  const externalId = externalIdOf(ref);
  const db = getAppDb();
  const [already] = await db
    .select({ id: connection.id })
    .from(connection)
    .where(
      and(
        eq(connection.workspaceId, ws.id),
        eq(connection.kind, 'google_sheet'),
        eq(connection.externalId, externalId),
      ),
    );
  if (already) throw new ConnectionError('This sheet is already linked. It updates by itself.');
  let sheet;
  try {
    sheet = await fetchSheet(ref);
  } catch (err) {
    throw new ConnectionError(friendly(err));
  }
  const fingerprint = await contentFingerprint([sheet.file]);
  const [row] = await db
    .insert(connection)
    .values({
      workspaceId: ws.id,
      kind: 'google_sheet',
      externalId,
      name: sheet.title,
      createdBy: input.userId,
      lastFingerprint: fingerprint,
      lastCheckedAt: new Date(),
      lastChangedAt: new Date(),
    })
    .returning({ id: connection.id });
  const connectionId = row!.id;
  try {
    const { runId } = await startIngestion({
      member: input.member,
      userId: input.userId,
      files: [sheet.file],
      queue: input.queue,
      connectionId,
    });
    await db.update(connection).set({ lastRunId: runId }).where(eq(connection.id, connectionId));
    await db.insert(auditEvent).values({
      workspaceId: ws.id,
      userId: input.userId,
      action: 'connection.linked',
      details: { connectionId, kind: 'google_sheet' },
    });
    return { connectionId, runId };
  } catch (err) {
    await db.delete(connection).where(eq(connection.id, connectionId));
    throw new ConnectionError(friendly(err));
  }
}

/** Records a new connection made elsewhere (Shopify's install) and starts its first import. */
export async function startConnection(input: {
  member: MemberWorkspace;
  userId: string;
  connectionId: string;
  queue: { enqueue: JobEnqueuer };
}): Promise<{ runId: string }> {
  const db = getAppDb();
  const [c] = await db
    .select()
    .from(connection)
    .where(
      and(
        eq(connection.id, input.connectionId),
        eq(connection.workspaceId, input.member.workspace.id),
      ),
    );
  if (!c) throw new ConnectionError('We couldn’t find that connection.');
  let fetched: Fetched;
  try {
    fetched = await fetchConnection(c);
  } catch (err) {
    await markProblem(c, err);
    throw new ConnectionError(friendly(err));
  }
  const fingerprint = await contentFingerprint(fetched.files);
  const { runId } = await startIngestion({
    member: input.member,
    userId: input.userId,
    files: fetched.files,
    queue: input.queue,
    connectionId: c.id,
  });
  await db
    .update(connection)
    .set({
      lastRunId: runId,
      lastFingerprint: fingerprint,
      lastCheckedAt: new Date(),
      lastChangedAt: new Date(),
      lastError: null,
      status: 'active',
      updatedAt: new Date(),
    })
    .where(eq(connection.id, c.id));
  return { runId };
}

async function markProblem(c: Connection, err: unknown): Promise<void> {
  const attention = err instanceof SourceError && err.kind === 'needs_attention';
  if (!(err instanceof SourceError))
    log().error({ err, connectionId: c.id }, 'source check failed');
  await getAppDb()
    .update(connection)
    .set({
      lastError: friendly(err),
      ...(attention ? { status: 'needs_attention' as const } : {}),
      updatedAt: new Date(),
    })
    .where(eq(connection.id, c.id));
}

export type SyncOutcome = 'started' | 'unchanged' | 'busy' | 'skipped' | 'problem';

/**
 * Checks one source for changes (the daily job and "Update now"). Safe to call repeatedly: a check
 * within a minute of the last, or while an import from this source is unfinished, does nothing.
 */
export async function syncConnection(
  connectionId: string,
  enqueue: JobEnqueuer,
  now = new Date(),
): Promise<SyncOutcome> {
  const db = getAppDb();
  // Claim the check: only one caller per minute gets the row back.
  const [c] = await db
    .update(connection)
    .set({ lastCheckedAt: now })
    .where(
      and(
        eq(connection.id, connectionId),
        inArray(connection.status, ['active', 'needs_attention']),
        or(
          isNull(connection.lastCheckedAt),
          lt(connection.lastCheckedAt, new Date(now.getTime() - MIN_CHECK_INTERVAL_MS)),
        ),
      ),
    )
    .returning();
  if (!c) return 'skipped';
  const [busy] = await db
    .select({ id: ingestionRun.id })
    .from(ingestionRun)
    .where(
      and(eq(ingestionRun.connectionId, c.id), notInArray(ingestionRun.status, [...UNFINISHED])),
    )
    .limit(1);
  if (busy) return 'busy';

  // Imports run as the person who linked the source, while they're still part of the business.
  const member = await memberFor(c);
  if (!member) {
    await markProblem(
      c,
      new SourceError(
        'The person who linked this is no longer part of this business. Please link it again.',
        'needs_attention',
      ),
    );
    return 'problem';
  }
  let fetched: Fetched;
  try {
    fetched = await fetchConnection(c);
  } catch (err) {
    await markProblem(c, err);
    return 'problem';
  }
  const fingerprint = await contentFingerprint(fetched.files);
  if (fingerprint === c.lastFingerprint) {
    await db
      .update(connection)
      .set({ lastError: null, status: 'active', updatedAt: new Date() })
      .where(eq(connection.id, c.id));
    return 'unchanged';
  }
  try {
    const { runId } = await startIngestion({
      member: member.member,
      userId: member.userId,
      files: fetched.files,
      queue: { enqueue },
      connectionId: c.id,
    });
    await db
      .update(connection)
      .set({
        lastRunId: runId,
        lastFingerprint: fingerprint,
        lastChangedAt: now,
        lastError: null,
        status: 'active',
        name: fetched.name.slice(0, 120) || c.name,
        updatedAt: new Date(),
      })
      .where(eq(connection.id, c.id));
    log().info({ connectionId: c.id, runId }, 'source changed: import started');
    return 'started';
  } catch (err) {
    await markProblem(c, err);
    return 'problem';
  }
}

async function memberFor(c: Connection) {
  if (!c.createdBy) return null;
  const [ws] = await getAppDb()
    .select({ slug: workspace.slug, status: workspace.status })
    .from(workspace)
    .where(eq(workspace.id, c.workspaceId));
  if (!ws || ws.status !== 'active') return null;
  const member = await getMemberWorkspace(ws.slug, c.createdBy);
  return member ? { member, userId: c.createdBy } : null;
}

// --- For the owner ------------------------------------------------------------------------------

export interface ConnectionView {
  id: string;
  kind: ConnectionKind;
  name: string;
  status: ConnectionStatus;
  autoUpdate: boolean;
  lastCheckedAt: Date | null;
  lastChangedAt: Date | null;
  lastError: string | null;
  /** An import from this source waiting for the owner ("needs a look"). */
  waitingRunId: string | null;
  /** Where to see the source itself (the sheet), when there is one. */
  link: string | null;
}

export async function listConnections(member: MemberWorkspace): Promise<ConnectionView[]> {
  const db = getAppDb();
  const rows = await db
    .select()
    .from(connection)
    .where(eq(connection.workspaceId, member.workspace.id))
    .orderBy(desc(connection.createdAt));
  if (rows.length === 0) return [];
  const waiting = await db
    .select({ id: ingestionRun.id, connectionId: ingestionRun.connectionId })
    .from(ingestionRun)
    .where(
      and(
        eq(ingestionRun.workspaceId, member.workspace.id),
        inArray(ingestionRun.status, ['review', 'merge_review']),
        inArray(
          ingestionRun.connectionId,
          rows.map((r) => r.id),
        ),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    status: r.status,
    autoUpdate: r.autoUpdate,
    lastCheckedAt: r.lastCheckedAt,
    lastChangedAt: r.lastChangedAt,
    lastError: r.lastError,
    waitingRunId: waiting.find((w) => w.connectionId === r.id)?.id ?? null,
    link:
      r.kind === 'google_sheet'
        ? (() => {
            const ref = refOf(r.externalId);
            return ref.kind === 'doc'
              ? `https://docs.google.com/spreadsheets/d/${ref.id}/edit`
              : `https://docs.google.com/spreadsheets/d/e/${ref.id}/pubhtml`;
          })()
        : r.kind === 'shopify'
          ? `https://${r.externalId}/admin`
          : null,
  }));
}

async function ownConnection(member: MemberWorkspace, id: string): Promise<Connection> {
  const [c] = await getAppDb()
    .select()
    .from(connection)
    .where(and(eq(connection.id, id), eq(connection.workspaceId, member.workspace.id)));
  if (!c) throw new ConnectionError('We couldn’t find that source.');
  return c;
}

/** Pause or resume checking; turn automatic updates on or off. */
export async function updateConnection(
  member: MemberWorkspace,
  userId: string,
  id: string,
  change: { paused?: boolean; autoUpdate?: boolean },
): Promise<void> {
  const c = await ownConnection(member, id);
  if (c.status === 'disconnected' && change.paused === false)
    throw new ConnectionError('This source was disconnected. Please connect it again.');
  await getAppDb()
    .update(connection)
    .set({
      ...(change.paused === undefined
        ? {}
        : { status: change.paused ? ('paused' as const) : ('active' as const), lastError: null }),
      ...(change.autoUpdate === undefined ? {} : { autoUpdate: change.autoUpdate }),
      updatedAt: new Date(),
    })
    .where(eq(connection.id, c.id));
  await getAppDb()
    .insert(auditEvent)
    .values({
      workspaceId: member.workspace.id,
      userId,
      action: 'connection.updated',
      details: { connectionId: c.id, ...change },
    });
}

/**
 * Stops using a source. The records it brought in stay; past imports keep their history. Returns
 * the connection as it was, so a Shopify unlink can also tell Shopify.
 */
export async function unlinkConnection(
  member: MemberWorkspace,
  userId: string,
  id: string,
): Promise<Connection> {
  const c = await ownConnection(member, id);
  await getAppDb().transaction(async (tx) => {
    await tx.delete(connection).where(eq(connection.id, c.id));
    await tx.insert(auditEvent).values({
      workspaceId: member.workspace.id,
      userId,
      action: 'connection.unlinked',
      details: { connectionId: c.id, kind: c.kind },
    });
  });
  return c;
}

/** Sources due a daily check. */
export async function connectionsToCheck(): Promise<string[]> {
  const rows = await getAppDb()
    .select({ id: connection.id })
    .from(connection)
    .where(inArray(connection.status, ['active', 'needs_attention']))
    .orderBy(connection.lastCheckedAt);
  return rows.map((r) => r.id);
}

/** The connection a page asks about, for this business only. */
export async function getConnection(member: MemberWorkspace, id: string): Promise<Connection> {
  return ownConnection(member, id);
}
