import { createHash, randomBytes } from 'node:crypto';

import { apiKey, auditEvent, getAppDb, workspace, workspaceSettings, type ApiKey } from '@bizr/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { NotAllowedError, type MemberWorkspace } from '../workspaces/service';

/**
 * API keys (M16, ADR-066). A key belongs to one business, reads like a "can view" member (M13) and
 * can never change anything. Only its SHA-256 is stored; the key is shown once when created.
 */

export const MAX_KEYS_PER_BUSINESS = 10;
/** Requests per key per minute. */
export const API_RATE_PER_MINUTE = 60;
const KEY_PREFIX = 'bzr_';

export class ApiKeyError extends Error {}

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

function requireOwner(member: MemberWorkspace, what: string) {
  if (member.role !== 'owner') throw new NotAllowedError(`Only the owner can ${what}.`);
}

const view = (k: ApiKey): ApiKeyView => ({
  id: k.id,
  name: k.name,
  prefix: k.prefix,
  createdAt: k.createdAt,
  lastUsedAt: k.lastUsedAt,
});

const nameSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'Give the key a name.').max(60, 'Names need 60 characters or fewer.'));

/** Creates a key. The returned `key` is the only time it is ever seen. */
export async function createApiKey(
  member: MemberWorkspace,
  userId: string,
  input: { name: string },
): Promise<{ key: string; view: ApiKeyView }> {
  requireOwner(member, 'create API keys');
  if (member.workspace.isDemo)
    throw new ApiKeyError('The demo shop can’t be connected to other apps.');
  const parsed = nameSchema.safeParse(input.name);
  if (!parsed.success) throw new ApiKeyError(parsed.error.issues[0]!.message);
  const db = getAppDb();
  const active = await listApiKeys(member);
  if (active.length >= MAX_KEYS_PER_BUSINESS)
    throw new ApiKeyError(
      `A business can have ${MAX_KEYS_PER_BUSINESS} keys. Revoke one you no longer use.`,
    );
  const key = `${KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
  const row = await db.transaction(async (tx) => {
    const [k] = await tx
      .insert(apiKey)
      .values({
        workspaceId: member.workspace.id,
        name: parsed.data,
        prefix: key.slice(0, KEY_PREFIX.length + 6),
        hash: hashKey(key),
        createdBy: userId,
      })
      .returning();
    await tx.insert(auditEvent).values({
      workspaceId: member.workspace.id,
      userId,
      action: 'api_key.created',
      details: { keyId: k!.id, name: parsed.data },
    });
    return k!;
  });
  return { key, view: view(row) };
}

export async function listApiKeys(member: MemberWorkspace): Promise<ApiKeyView[]> {
  const rows = await getAppDb()
    .select()
    .from(apiKey)
    .where(and(eq(apiKey.workspaceId, member.workspace.id), isNull(apiKey.revokedAt)))
    .orderBy(asc(apiKey.createdAt));
  return rows.map(view);
}

/** Revoking takes effect on the very next request. */
export async function revokeApiKey(
  member: MemberWorkspace,
  userId: string,
  id: string,
): Promise<void> {
  requireOwner(member, 'revoke API keys');
  const db = getAppDb();
  await db.transaction(async (tx) => {
    const [k] = await tx
      .update(apiKey)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiKey.id, id),
          eq(apiKey.workspaceId, member.workspace.id),
          isNull(apiKey.revokedAt),
        ),
      )
      .returning({ id: apiKey.id, name: apiKey.name });
    if (!k) throw new ApiKeyError('That key isn’t there any more.');
    await tx.insert(auditEvent).values({
      workspaceId: member.workspace.id,
      userId,
      action: 'api_key.revoked',
      details: { keyId: k.id, name: k.name },
    });
  });
}

export type ApiAuth =
  | { ok: true; member: MemberWorkspace; keyId: string }
  | { ok: false; reason: 'unauthorized' }
  | { ok: false; reason: 'rate_limited'; retryAfter: number };

/** The bearer token from an `Authorization` header, if it looks like one of our keys. */
export function bearerKey(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? '');
  const key = m?.[1];
  return key && key.startsWith(KEY_PREFIX) && key.length <= 100 ? key : null;
}

/**
 * Checks a key and counts the request in one statement: the minute's count goes up, or starts
 * again at 1 in a new minute. A revoked key, or a business that isn't active, is refused.
 */
export async function authenticateApiKey(key: string | null, now = new Date()): Promise<ApiAuth> {
  if (!key) return { ok: false, reason: 'unauthorized' };
  const db = getAppDb();
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const [k] = await db
    .update(apiKey)
    .set({
      windowCount: sql`case when ${apiKey.windowStart} = ${minute.toISOString()}::timestamptz then ${apiKey.windowCount} + 1 else 1 end`,
      windowStart: minute,
      lastUsedAt: now,
    })
    .where(and(eq(apiKey.hash, hashKey(key)), isNull(apiKey.revokedAt)))
    .returning({ id: apiKey.id, workspaceId: apiKey.workspaceId, count: apiKey.windowCount });
  if (!k) return { ok: false, reason: 'unauthorized' };
  if (k.count > API_RATE_PER_MINUTE)
    return {
      ok: false,
      reason: 'rate_limited',
      retryAfter: Math.max(1, Math.ceil((minute.getTime() + 60_000 - now.getTime()) / 1000)),
    };
  const [row] = await db
    .select({ workspace, settings: workspaceSettings })
    .from(workspace)
    .innerJoin(workspaceSettings, eq(workspaceSettings.workspaceId, workspace.id))
    .where(eq(workspace.id, k.workspaceId))
    .limit(1);
  if (!row || row.workspace.status !== 'active' || row.workspace.isDemo)
    return { ok: false, reason: 'unauthorized' };
  return { ok: true, member: { ...row, role: 'viewer' }, keyId: k.id };
}
