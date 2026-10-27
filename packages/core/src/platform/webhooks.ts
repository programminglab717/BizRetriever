import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

import {
  auditEvent,
  getAppDb,
  insight,
  webhook,
  webhookDelivery,
  webhookEvents,
  workspace,
  type Webhook,
  type WebhookDelivery,
  type WebhookEvent,
} from '@bizr/db';
import { getEnv, getLogger } from '@bizr/platform';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { connectorSecretsEnabled, openSecret, sealSecret } from '../connections/secret';
import { NotAllowedError, type MemberWorkspace } from '../workspaces/service';
import { isPublicAddress, publicOnlyLookup } from './net';

/**
 * Webhooks (M16, ADR-066): an https address the owner adds is told when something happens in the
 * business. Events are written to an outbox (`webhook_delivery`) once each, sent by background
 * work with retries, and signed so the receiver can check they came from us. Never sent to a
 * private or internal address (checked on the address actually connected to).
 */

export const MAX_WEBHOOKS_PER_BUSINESS = 5;
/** Waits before attempts 2–6; after the 6th failure (about a day and a half) the webhook is off. */
export const RETRY_DELAYS_MS = [60_000, 10 * 60_000, 60 * 60_000, 6 * 3_600_000, 24 * 3_600_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const TIMEOUT_MS = 10_000;
const LEASE_MS = 60_000;
const SIGNATURE_TOLERANCE_S = 300;

export const EVENT_LABELS: Record<WebhookEvent, string> = {
  'insight.created': 'Something new is worth knowing (a new insight)',
  'import.completed': 'New data was brought in (an import finished)',
};

export class WebhookError extends Error {}

export interface WebhookView {
  id: string;
  url: string;
  events: WebhookEvent[];
  createdAt: Date;
  disabled: boolean;
  lastDeliveryAt: Date | null;
  lastStatus: number | null;
  lastError: string | null;
}

const log = () => getLogger('webhooks');
const allowPrivate = () => getEnv().WEBHOOKS_ALLOW_PRIVATE === 'on';

function requireOwner(member: MemberWorkspace, what: string) {
  if (member.role !== 'owner') throw new NotAllowedError(`Only the owner can ${what}.`);
}

const view = (w: Webhook): WebhookView => ({
  id: w.id,
  url: w.url,
  events: w.events.filter((e): e is WebhookEvent =>
    (webhookEvents as readonly string[]).includes(e),
  ),
  createdAt: w.createdAt,
  disabled: w.disabledAt !== null,
  lastDeliveryAt: w.lastDeliveryAt,
  lastStatus: w.lastStatus,
  lastError: w.lastError,
});

export function webhooksAvailable(): boolean {
  return connectorSecretsEnabled();
}

/** Checks an address someone typed. Throws a plain-language `WebhookError` when it can't be used. */
export function checkWebhookUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new WebhookError('That doesn’t look like a web address. It should start with https://');
  }
  const local = allowPrivate();
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new WebhookError('The address has to start with https://');
  if (url.username || url.password)
    throw new WebhookError('Leave the user name and password out of the address.');
  if (url.href.length > 500) throw new WebhookError('That address is too long.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const internal =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    (isIP(host) !== 0 && !isPublicAddress(host)) ||
    (isIP(host) === 0 && !host.includes('.'));
  if (internal && !local)
    throw new WebhookError('That address is on a private network. Use a public https address.');
  url.hash = '';
  return url.href;
}

const createSchema = z
  .object({
    url: z.string().min(1, 'Add the address to send to.'),
    events: z.array(z.enum(webhookEvents)).min(1, 'Pick at least one thing to be told about.'),
  })
  .strict();

/** Adds a webhook. The returned `secret` (for checking signatures) is shown only this once. */
export async function createWebhook(
  member: MemberWorkspace,
  userId: string,
  input: { url: string; events: string[] },
): Promise<{ secret: string; view: WebhookView }> {
  requireOwner(member, 'add webhooks');
  if (member.workspace.isDemo)
    throw new WebhookError('The demo shop can’t be connected to other apps.');
  if (!webhooksAvailable())
    throw new WebhookError('Webhooks aren’t switched on for this BizRetriever yet.');
  const parsed = createSchema.safeParse({ ...input, events: [...new Set(input.events)] });
  if (!parsed.success) throw new WebhookError(parsed.error.issues[0]!.message);
  const url = checkWebhookUrl(parsed.data.url);
  const existing = await listWebhooks(member);
  if (existing.length >= MAX_WEBHOOKS_PER_BUSINESS)
    throw new WebhookError(`A business can have ${MAX_WEBHOOKS_PER_BUSINESS} webhooks.`);
  const secret = `whsec_${randomBytes(24).toString('base64url')}`;
  const row = await getAppDb().transaction(async (tx) => {
    const [w] = await tx
      .insert(webhook)
      .values({
        workspaceId: member.workspace.id,
        url,
        events: parsed.data.events,
        secret: sealSecret(secret),
        createdBy: userId,
      })
      .returning();
    await tx.insert(auditEvent).values({
      workspaceId: member.workspace.id,
      userId,
      action: 'webhook.created',
      details: { webhookId: w!.id, url, events: parsed.data.events },
    });
    return w!;
  });
  return { secret, view: view(row) };
}

export async function listWebhooks(member: MemberWorkspace): Promise<WebhookView[]> {
  requireOwner(member, 'see webhooks');
  const rows = await getAppDb()
    .select()
    .from(webhook)
    .where(eq(webhook.workspaceId, member.workspace.id))
    .orderBy(asc(webhook.createdAt));
  return rows.map(view);
}

/** Delete it, or turn it back on after it was switched off for failing. */
export async function updateWebhook(
  member: MemberWorkspace,
  userId: string,
  id: string,
  change: 'delete' | 'enable',
): Promise<void> {
  requireOwner(member, 'change webhooks');
  const db = getAppDb();
  await db.transaction(async (tx) => {
    const where = and(eq(webhook.id, id), eq(webhook.workspaceId, member.workspace.id));
    const [w] =
      change === 'delete'
        ? await tx.delete(webhook).where(where).returning({ id: webhook.id, url: webhook.url })
        : await tx
            .update(webhook)
            .set({ disabledAt: null, failures: 0 })
            .where(where)
            .returning({ id: webhook.id, url: webhook.url });
    if (!w) throw new WebhookError('That webhook isn’t there any more.');
    await tx.insert(auditEvent).values({
      workspaceId: member.workspace.id,
      userId,
      action: change === 'delete' ? 'webhook.deleted' : 'webhook.enabled',
      details: { webhookId: w.id, url: w.url },
    });
  });
}

// --- Signatures ----------------------------------------------------------------------------------

export function signWebhook(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * What a receiver does (docs/API.md): the `BizRetriever-Signature` header is `t=<unix seconds>,
 * v1=<hex HMAC-SHA256 of "t.body">`. Refuses old timestamps, so a captured delivery can't be
 * replayed later.
 */
export function verifyWebhookSignature(
  secret: string,
  header: string | null,
  body: string,
  now = Date.now(),
): boolean {
  const parts = Object.fromEntries(
    (header ?? '').split(',').map((p) => p.trim().split('=', 2) as [string, string]),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return false;
  if (Math.abs(now / 1000 - t) > SIGNATURE_TOLERANCE_S) return false;
  const expected = Buffer.from(signWebhook(secret, t, body), 'hex');
  const given = Buffer.from(parts.v1, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// --- Sending -------------------------------------------------------------------------------------

export interface SendResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}

/** One POST, no redirects followed, to a public address only. */
export async function postWebhook(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<SendResult> {
  const target = new URL(url);
  const local = allowPrivate();
  const host = target.hostname.replace(/^\[|\]$/g, '');
  // An address typed as numbers is connected to without a lookup: check it here.
  if (isIP(host) !== 0 && !isPublicAddress(host) && !local)
    return { ok: false, status: null, error: 'That address is on a private network.' };
  const lib = target.protocol === 'http:' ? http : https;
  if (target.protocol === 'http:' && !local)
    return { ok: false, status: null, error: 'The address has to start with https://' };
  return new Promise<SendResult>((resolve) => {
    const req = lib.request(
      target,
      {
        method: 'POST',
        headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) },
        lookup: publicOnlyLookup(local),
        timeout: TIMEOUT_MS,
      },
      (res) => {
        // The answer's body doesn't matter; read a little and stop.
        let seen = 0;
        res.on('data', (c: Buffer) => {
          seen += c.length;
          if (seen > 4096) res.destroy();
        });
        res.on('close', () => {
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            error: status >= 200 && status < 300 ? null : `The address answered ${status}.`,
          });
        });
        res.on('error', () => {});
      },
    );
    req.on('timeout', () => req.destroy(new Error('No answer within 10 seconds.')));
    req.on('error', (err: NodeJS.ErrnoException) =>
      resolve({
        ok: false,
        status: null,
        error:
          err.code === 'EBLOCKED'
            ? 'That address is on a private network.'
            : err.code === 'ENOTFOUND'
              ? 'That address couldn’t be found.'
              : err.message.slice(0, 200),
      }),
    );
    req.end(body);
  });
}

interface Envelope {
  id: string;
  type: WebhookEvent | 'ping';
  createdAt: string;
  business: { name: string; slug: string };
  data: unknown;
}

async function sendTo(w: Webhook, deliveryId: string, envelope: Envelope): Promise<SendResult> {
  const body = JSON.stringify(envelope);
  const t = Math.floor(Date.now() / 1000);
  return postWebhook(
    w.url,
    {
      'content-type': 'application/json',
      'user-agent': 'BizRetriever-Webhooks/1.0',
      'bizretriever-event': envelope.type,
      'bizretriever-delivery': deliveryId,
      'bizretriever-signature': `t=${t},v1=${signWebhook(openSecret<string>(w.secret), t, body)}`,
    },
    body,
  );
}

/** "Send a test": a `ping` now, once, without retries. */
export async function sendTestWebhook(
  member: MemberWorkspace,
  userId: string,
  id: string,
): Promise<SendResult> {
  requireOwner(member, 'test webhooks');
  const db = getAppDb();
  const [w] = await db
    .select()
    .from(webhook)
    .where(and(eq(webhook.id, id), eq(webhook.workspaceId, member.workspace.id)));
  if (!w) throw new WebhookError('That webhook isn’t there any more.');
  const testId = `ping_${randomBytes(8).toString('hex')}`;
  const r = await sendTo(w, testId, {
    id: testId,
    type: 'ping',
    createdAt: new Date().toISOString(),
    business: { name: member.workspace.name, slug: member.workspace.slug },
    data: { message: 'This is a test from BizRetriever.' },
  });
  await db
    .update(webhook)
    .set({ lastDeliveryAt: new Date(), lastStatus: r.status, lastError: r.error })
    .where(eq(webhook.id, w.id));
  log().info({ workspaceId: member.workspace.id, webhookId: w.id, userId, ok: r.ok }, 'test sent');
  return r;
}

// --- The outbox ----------------------------------------------------------------------------------

/**
 * Queues an event for every webhook of the business that asked for it. Safe to call again for the
 * same `key`: each webhook gets it once. Returns how many deliveries were queued.
 */
export async function recordWebhookEvent(
  workspaceId: string,
  event: WebhookEvent,
  key: string,
  data: unknown,
  now = new Date(),
): Promise<number> {
  const db = getAppDb();
  const hooks = await db
    .select({ id: webhook.id })
    .from(webhook)
    .where(
      and(
        eq(webhook.workspaceId, workspaceId),
        isNull(webhook.disabledAt),
        sql`${event} = any(${webhook.events})`,
      ),
    );
  if (hooks.length === 0) return 0;
  const [ws] = await db
    .select({ name: workspace.name, slug: workspace.slug, isDemo: workspace.isDemo })
    .from(workspace)
    .where(eq(workspace.id, workspaceId));
  if (!ws || ws.isDemo) return 0;
  const envelope: Envelope = {
    id: key,
    type: event,
    createdAt: now.toISOString(),
    business: { name: ws.name, slug: ws.slug },
    data,
  };
  const rows = await db
    .insert(webhookDelivery)
    .values(
      hooks.map((h) => ({
        webhookId: h.id,
        workspaceId,
        event,
        eventKey: key,
        payload: envelope,
        nextAttemptAt: now,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: webhookDelivery.id });
  return rows.length;
}

/** New insights, told to webhooks that asked for `insight.created`. */
export async function recordInsightEvents(
  workspaceId: string,
  insightIds: readonly string[],
  now = new Date(),
): Promise<number> {
  if (insightIds.length === 0) return 0;
  const rows = await getAppDb()
    .select()
    .from(insight)
    .where(and(eq(insight.workspaceId, workspaceId), inArray(insight.id, [...insightIds])));
  const [ws] = await getAppDb()
    .select({ slug: workspace.slug })
    .from(workspace)
    .where(eq(workspace.id, workspaceId));
  let n = 0;
  for (const r of rows) {
    const words = (s: readonly { text: string }[] | null) =>
      s
        ?.map((x) => x.text)
        .join('')
        .trim() ?? '';
    n += await recordWebhookEvent(
      workspaceId,
      'insight.created',
      `insight:${r.id}`,
      {
        insight: {
          id: r.id,
          level: r.level,
          category: r.category,
          text: words(r.headline) || r.text,
          detail: words(r.context),
          link: `${getEnv().APP_URL}/w/${ws?.slug ?? ''}/insights`,
        },
      },
      now,
    );
  }
  return n;
}

/** Takes up to `limit` due deliveries, held for a minute so no one else sends them meanwhile. */
async function claimDue(now: Date, limit: number, workspaceId?: string) {
  const db = getAppDb();
  return db
    .update(webhookDelivery)
    .set({ lockedUntil: new Date(now.getTime() + LEASE_MS) })
    .where(
      inArray(
        webhookDelivery.id,
        db
          .select({ id: webhookDelivery.id })
          .from(webhookDelivery)
          .where(
            and(
              eq(webhookDelivery.status, 'pending'),
              sql`${webhookDelivery.nextAttemptAt} <= ${now.toISOString()}::timestamptz`,
              sql`(${webhookDelivery.lockedUntil} is null or ${webhookDelivery.lockedUntil} < ${now.toISOString()}::timestamptz)`,
              ...(workspaceId ? [eq(webhookDelivery.workspaceId, workspaceId)] : []),
            ),
          )
          .orderBy(asc(webhookDelivery.nextAttemptAt))
          .limit(limit)
          .for('update', { skipLocked: true }),
      ),
    )
    .returning();
}

async function settle(d: WebhookDelivery, w: Webhook | undefined, r: SendResult, now: Date) {
  const db = getAppDb();
  const attempts = d.attempts + 1;
  if (r.ok) {
    await db
      .update(webhookDelivery)
      .set({
        status: 'sent',
        attempts,
        sentAt: now,
        lastStatus: r.status,
        lastError: null,
        lockedUntil: null,
      })
      .where(eq(webhookDelivery.id, d.id));
    if (w)
      await db
        .update(webhook)
        .set({ failures: 0, lastDeliveryAt: now, lastStatus: r.status, lastError: null })
        .where(eq(webhook.id, w.id));
    return;
  }
  const last = attempts >= MAX_ATTEMPTS || !w || w.disabledAt !== null;
  await db
    .update(webhookDelivery)
    .set({
      status: last ? 'failed' : 'pending',
      attempts,
      nextAttemptAt: new Date(now.getTime() + (RETRY_DELAYS_MS[attempts - 1] ?? 0)),
      lastStatus: r.status,
      lastError: r.error,
      lockedUntil: null,
    })
    .where(eq(webhookDelivery.id, d.id));
  if (w && w.disabledAt === null) {
    // A delivery that failed every try means the address is broken: stop sending until the owner
    // turns it back on (Connect other apps shows why).
    await db
      .update(webhook)
      .set({
        failures: sql`${webhook.failures} + 1`,
        lastDeliveryAt: now,
        lastStatus: r.status,
        lastError: r.error,
        ...(attempts >= MAX_ATTEMPTS ? { disabledAt: now } : {}),
      })
      .where(eq(webhook.id, w.id));
    if (attempts >= MAX_ATTEMPTS)
      log().warn(
        { webhookId: w.id, workspaceId: w.workspaceId },
        'webhook turned off after failures',
      );
  }
}

/**
 * Sends what is due, oldest first, until none is left or the deadline passes. Returns how many were
 * attempted. Run by background work only (a job step), never while a person waits.
 */
export async function deliverDueWebhooks(
  options: { workspaceId?: string; now?: () => Date; deadline?: number; batch?: number } = {},
): Promise<{ attempted: number; sent: number }> {
  const clock = options.now ?? (() => new Date());
  const deadline = options.deadline ?? Date.now() + 30_000;
  let attempted = 0;
  let sent = 0;
  while (Date.now() < deadline) {
    const due = await claimDue(clock(), options.batch ?? 10, options.workspaceId);
    if (due.length === 0) break;
    const ids = [...new Set(due.map((d) => d.webhookId))];
    const hooks = await getAppDb().select().from(webhook).where(inArray(webhook.id, ids));
    for (const d of due) {
      const w = hooks.find((h) => h.id === d.webhookId);
      const r: SendResult =
        w && w.disabledAt === null
          ? await sendTo(w, d.id, d.payload as Envelope).catch((err: unknown) => ({
              ok: false,
              status: null,
              error: err instanceof Error ? err.message.slice(0, 200) : 'Sending failed.',
            }))
          : { ok: false, status: null, error: 'The webhook is turned off.' };
      await settle(d, w, r, clock());
      attempted += 1;
      if (r.ok) sent += 1;
    }
  }
  return { attempted, sent };
}

/** Whether anything is waiting to be (re)sent now: the hourly check queues the retry job then. */
export async function webhooksDue(now = new Date()): Promise<boolean> {
  const [row] = await getAppDb()
    .select({ id: webhookDelivery.id })
    .from(webhookDelivery)
    .where(
      and(
        eq(webhookDelivery.status, 'pending'),
        sql`${webhookDelivery.nextAttemptAt} <= ${now.toISOString()}::timestamptz`,
      ),
    )
    .limit(1);
  return Boolean(row);
}
