'use server';

import {
  answerTransfer,
  cancelTransfer,
  startTransfer,
  TeamError,
  type TransferView,
} from '@bizr/core/team';
import { NotAllowedError } from '@bizr/core/workspaces';
import { getLogger } from '@bizr/platform';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getT } from '@/lib/i18n';
import { requireWorkspace } from '@/lib/session';

/** Handing the business over (M19). Who may do what is checked in the core service. */

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function guard<T>(
  slug: string,
  fn: () => Promise<T>,
  refresh: (data: T) => boolean = () => true,
): Promise<Result<T>> {
  try {
    const data = await fn();
    if (refresh(data)) revalidatePath(`/w/${slug}`, 'layout');
    return { ok: true, data };
  } catch (err) {
    const t = await getT();
    if (err instanceof TeamError || err instanceof NotAllowedError)
      return { ok: false, error: t.text(err.message) };
    getLogger('ownership').error({ err, slug }, 'ownership action failed');
    return { ok: false, error: t('Something went wrong. Please try again.') };
  }
}

async function stale(): Promise<{ ok: false; error: string }> {
  const t = await getT();
  return { ok: false, error: t('This page is out of date. Refresh it.') };
}

export async function offerOwnership(
  slug: string,
  toUserId: string,
  confirmName: string,
): Promise<Result<TransferView>> {
  const member = await requireWorkspace(slug);
  if (!z.uuid().safeParse(toUserId).success) return stale();
  return guard(slug, () =>
    startTransfer(member, member.user.id, { toUserId, confirmName: String(confirmName) }),
  );
}

export async function cancelOwnership(slug: string): Promise<Result<null>> {
  const member = await requireWorkspace(slug);
  return guard(slug, async () => {
    await cancelTransfer(member, member.user.id);
    return null;
  });
}

export async function answerOwnership(
  slug: string,
  transferId: string,
  accept: boolean,
): Promise<Result<'accepted' | 'declined'>> {
  const member = await requireWorkspace(slug);
  if (!z.uuid().safeParse(transferId).success || typeof accept !== 'boolean') return stale();
  // Accepting changes what the person can do: the page refreshes into the owner's Settings.
  // Declining changes nothing, so the card stays to say so.
  return guard(
    slug,
    () => answerTransfer(member, member.user.id, transferId, accept),
    (r) => r === 'accepted',
  );
}
