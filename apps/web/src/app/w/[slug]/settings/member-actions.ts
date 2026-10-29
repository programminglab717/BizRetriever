'use server';

import {
  assignableRoles,
  changeRole,
  createInvite,
  InviteError,
  NotAllowedError,
  removeMember,
  revokeInvite,
} from '@bizr/core/workspaces';
import { getEnv, getLogger } from '@bizr/platform';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { translator } from '@bizr/i18n';

import { sendEmail } from '@/lib/email';
import { getT } from '@/lib/i18n';
import { requireWorkspace } from '@/lib/session';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function guard<T>(slug: string, fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = await fn();
    revalidatePath(`/w/${slug}/settings`);
    return { ok: true, data };
  } catch (err) {
    const t = await getT();
    if (err instanceof InviteError || err instanceof NotAllowedError)
      return { ok: false, error: t.text(err.message) };
    getLogger('members').error({ err, slug }, 'member action failed');
    return { ok: false, error: t('Something went wrong. Please try again.') };
  }
}

/** Invites someone by email. The link is also returned, to share another way. */
const role = z.enum(assignableRoles);

export async function inviteMember(
  slug: string,
  email: string,
  as: string = 'member',
): Promise<Result<{ link: string; emailed: boolean }>> {
  const member = await requireWorkspace(slug);
  const t = await getT();
  const r = role.safeParse(as);
  if (!r.success) return { ok: false, error: t('Please choose what they can do.') };
  return guard(slug, async () => {
    const invite = await createInvite(member, member.user.id, String(email).slice(0, 254), r.data);
    const env = getEnv();
    const link = `${env.APP_URL}/invite/${invite.token}`;
    // The person invited has no language yet: the business's (M20).
    const tr = translator(member.settings.language);
    const vars = { who: member.user.name, business: member.workspace.name, link };
    await sendEmail({
      to: invite.email,
      subject: tr('{who} invited you to {business} on BizRetriever', vars),
      text:
        r.data === 'viewer'
          ? tr(
              '{who} invited you to see {business} on BizRetriever.\n\nJoin here (the link works for 7 days):\n{link}\n',
              vars,
            )
          : tr(
              '{who} invited you to help run {business} on BizRetriever.\n\nJoin here (the link works for 7 days):\n{link}\n',
              vars,
            ),
    });
    return { link, emailed: Boolean(env.RESEND_API_KEY) };
  });
}

export async function cancelInvite(slug: string, inviteId: string): Promise<Result<null>> {
  const member = await requireWorkspace(slug);
  const t = await getT();
  if (!z.uuid().safeParse(inviteId).success)
    return { ok: false, error: t('We couldn’t find that invitation.') };
  return guard(slug, async () => {
    await revokeInvite(member, member.user.id, inviteId);
    return null;
  });
}

export async function removePerson(slug: string, userId: string): Promise<Result<null>> {
  const member = await requireWorkspace(slug);
  const t = await getT();
  if (!z.uuid().safeParse(userId).success)
    return { ok: false, error: t('We couldn’t find that person.') };
  return guard(slug, async () => {
    await removeMember(member, member.user.id, userId);
    return null;
  });
}

/** The owner changes what someone can do. */
export async function changePersonRole(
  slug: string,
  userId: string,
  to: string,
): Promise<Result<null>> {
  const member = await requireWorkspace(slug);
  const t = await getT();
  const r = role.safeParse(to);
  if (!z.uuid().safeParse(userId).success || !r.success)
    return { ok: false, error: t('We couldn’t find that person.') };
  return guard(slug, async () => {
    await changeRole(member, member.user.id, userId, r.data);
    return null;
  });
}
