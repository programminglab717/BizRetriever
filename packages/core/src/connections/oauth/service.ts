import { randomBytes, timingSafeEqual } from 'node:crypto';

import { auditEvent, connection, getAppDb } from '@bizr/db';
import { getEnv, getLogger } from '@bizr/platform';
import { and, eq } from 'drizzle-orm';

import type { JobEnqueuer } from '../../jobs/define';
import {
  canChange,
  getMemberWorkspace,
  requireEditor,
  type MemberWorkspace,
} from '../../workspaces/service';
import { SourceError } from '../fetch';
import { connectionSyncJob } from '../jobs';
import { openSecret, sealSecret } from '../secret';
import type { Connection, OAuthKind, OAuthProvider, OAuthTokens } from './provider';

/**
 * Connecting through a provider's sign-in, the same way for each (M18, ADR-068; Shopify's own,
 * ADR-059, came first and works alike). `beginConnect` sends the owner off with a random state
 * kept in a sealed, ten-minute cookie naming who asked and for which business. `completeConnect`
 * checks that state, the time, the signed-in person and that they can still change things, swaps
 * the code, stores the tokens sealed and queues the first check, whose import the owner reviews.
 */

const log = () => getLogger('connections');
const STATE_TTL_MS = 10 * 60_000;

export class ConnectError extends Error {}

export const connectStateCookie = (kind: OAuthKind) => `bizr_${kind}_state`;
export const connectCookiePath = (kind: OAuthKind) => `/api/connect/${kind}`;
export const callbackUrl = (kind: OAuthKind) =>
  new URL(`/api/connect/${kind}/callback`, getEnv().APP_URL).toString();

interface ConnectState {
  kind: OAuthKind;
  state: string;
  workspaceId: string;
  slug: string;
  userId: string;
  exp: number;
}

export function beginConnect(
  provider: OAuthProvider,
  member: MemberWorkspace,
  userId: string,
  now = Date.now(),
): { url: string; cookie: string; maxAgeSeconds: number } {
  requireEditor(member);
  if (!provider.enabled()) throw new ConnectError(`${provider.label} isn’t switched on here yet.`);
  const state = randomBytes(24).toString('base64url');
  const cookie = sealSecret({
    kind: provider.kind,
    state,
    workspaceId: member.workspace.id,
    slug: member.workspace.slug,
    userId,
    exp: now + STATE_TTL_MS,
  } satisfies ConnectState);
  return { url: provider.authorizeUrl(state), cookie, maxAgeSeconds: STATE_TTL_MS / 1000 };
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Back from the provider. Returns where to send the owner. */
export async function completeConnect(
  provider: OAuthProvider,
  input: {
    params: URLSearchParams;
    cookie: string | undefined;
    sessionUserId: string | undefined;
    queue: { enqueue: JobEnqueuer };
    now?: Date;
  },
): Promise<{ slug: string; connectionId: string }> {
  const now = input.now ?? new Date();
  const refuse = () =>
    new ConnectError('That connection didn’t work. Please start again from My data.');
  if (!input.cookie || !input.sessionUserId) throw refuse();
  let saved: ConnectState;
  try {
    saved = openSecret<ConnectState>(input.cookie);
  } catch {
    throw refuse();
  }
  const state = input.params.get('state') ?? '';
  if (
    saved.kind !== provider.kind ||
    saved.exp < now.getTime() ||
    !same(saved.state, state) ||
    saved.userId !== input.sessionUserId
  )
    throw refuse();
  // The owner said no on the provider's page.
  if (input.params.get('error'))
    throw new ConnectError(`${provider.label} wasn’t connected. You can try again any time.`);
  if (!input.params.get('code')) throw refuse();
  const member = await getMemberWorkspace(saved.slug, saved.userId);
  if (
    !member ||
    member.workspace.id !== saved.workspaceId ||
    member.workspace.status !== 'active' ||
    !canChange(member.role)
  )
    throw refuse();

  let result;
  try {
    result = await provider.connect(input.params, now);
  } catch (err) {
    log().warn({ err, kind: provider.kind }, 'connect failed');
    throw new ConnectError(
      err instanceof SourceError
        ? err.message
        : `${provider.label} didn’t answer. Please try again.`,
    );
  }
  const { tokens, account } = result;
  const db = getAppDb();
  const values = {
    name: account.name.slice(0, 120) || provider.label,
    secret: sealSecret(tokens),
    status: 'active' as const,
    lastError: null,
    lastCheckedAt: null,
    config: account.config ?? {},
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(connection)
    .values({
      workspaceId: member.workspace.id,
      kind: provider.kind,
      externalId: account.externalId,
      createdBy: saved.userId,
      ...values,
    })
    .onConflictDoUpdate({
      target: [connection.workspaceId, connection.kind, connection.externalId],
      set: { ...values, createdBy: saved.userId },
    })
    .returning({ id: connection.id });
  const connectionId = row!.id;
  await db.insert(auditEvent).values({
    workspaceId: member.workspace.id,
    userId: saved.userId,
    action: 'connection.linked',
    details: { connectionId, kind: provider.kind },
  });
  await input.queue.enqueue(
    connectionSyncJob,
    { connectionId },
    { workspaceId: member.workspace.id },
  );
  return { slug: member.workspace.slug, connectionId };
}

/**
 * A working access token, refreshed when it is about to expire. The new pair is stored before it
 * is used, and only over the pair that was refreshed: if the owner connected again meanwhile, the
 * newer tokens win (as for Shopify, ADR-063).
 */
export async function oauthAccessToken(
  provider: OAuthProvider,
  c: Connection,
  now = new Date(),
): Promise<string> {
  if (!c.secret)
    throw new SourceError(
      `This ${provider.label} account isn’t connected any more. Please connect it again.`,
      'needs_attention',
    );
  let tokens = openSecret<OAuthTokens>(c.secret);
  const soon = now.getTime() + 5 * 60_000;
  if (tokens.expiresAt && Date.parse(tokens.expiresAt) <= soon) {
    if (
      !tokens.refreshToken ||
      (tokens.refreshExpiresAt && Date.parse(tokens.refreshExpiresAt) <= now.getTime())
    )
      throw new SourceError(
        `${provider.label} no longer lets us in. Please connect it again.`,
        'needs_attention',
      );
    tokens = await provider.refresh(tokens, now);
    const db = getAppDb();
    const kept = await db
      .update(connection)
      .set({ secret: sealSecret(tokens), updatedAt: new Date() })
      .where(and(eq(connection.id, c.id), eq(connection.secret, c.secret)))
      .returning({ id: connection.id });
    if (kept.length === 0) {
      const [fresh] = await db.select().from(connection).where(eq(connection.id, c.id));
      if (fresh?.secret && fresh.secret !== c.secret) return oauthAccessToken(provider, fresh, now);
    }
  }
  return tokens.accessToken;
}

/** The connection's fetcher for a provider. */
export async function fetchOAuth(provider: OAuthProvider, c: Connection, now = new Date()) {
  const token = await oauthAccessToken(provider, c, now);
  return provider.read(c, token, now);
}
