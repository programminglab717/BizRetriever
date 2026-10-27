'use server';

import {
  ApiKeyError,
  createApiKey,
  createWebhook,
  revokeApiKey,
  sendTestWebhook,
  updateWebhook,
  WebhookError,
  type ApiKeyView,
  type SendResult,
  type WebhookView,
} from '@bizr/core/platform';
import { NotAllowedError } from '@bizr/core/workspaces';
import { getLogger } from '@bizr/platform';
import { z } from 'zod';

import { requireEditor } from '@/lib/session';

/** Connect other apps (M16): owner only, checked again in the core services. */

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function guard<T>(slug: string, fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof ApiKeyError || err instanceof WebhookError || err instanceof NotAllowedError)
      return { ok: false, error: err.message };
    getLogger('apps').error({ err, slug }, 'connect-apps action failed');
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

const stale = { ok: false as const, error: 'This page is out of date. Refresh it.' };

export async function createKeyAction(
  slug: string,
  name: string,
): Promise<Result<{ key: string; view: ApiKeyView }>> {
  const member = await requireEditor(slug);
  return guard(slug, () => createApiKey(member, member.user.id, { name: String(name) }));
}

export async function revokeKeyAction(slug: string, id: string): Promise<Result<null>> {
  const member = await requireEditor(slug);
  if (!z.uuid().safeParse(id).success) return stale;
  return guard(slug, async () => {
    await revokeApiKey(member, member.user.id, id);
    return null;
  });
}

export async function createWebhookAction(
  slug: string,
  input: { url: string; events: string[] },
): Promise<Result<{ secret: string; view: WebhookView }>> {
  const member = await requireEditor(slug);
  const parsed = z
    .object({ url: z.string().max(1000), events: z.array(z.string()).max(10) })
    .safeParse(input);
  if (!parsed.success) return stale;
  return guard(slug, () => createWebhook(member, member.user.id, parsed.data));
}

export async function updateWebhookAction(
  slug: string,
  id: string,
  change: 'delete' | 'enable',
): Promise<Result<null>> {
  const member = await requireEditor(slug);
  if (!z.uuid().safeParse(id).success || (change !== 'delete' && change !== 'enable')) return stale;
  return guard(slug, async () => {
    await updateWebhook(member, member.user.id, id, change);
    return null;
  });
}

export async function testWebhookAction(slug: string, id: string): Promise<Result<SendResult>> {
  const member = await requireEditor(slug);
  if (!z.uuid().safeParse(id).success) return stale;
  return guard(slug, () => sendTestWebhook(member, member.user.id, id));
}
