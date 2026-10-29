'use server';

import { acceptInvite, InviteError } from '@bizr/core/workspaces';
import type { Route } from 'next';
import { redirect } from 'next/navigation';

import { getT } from '@/lib/i18n';
import { requireUser } from '@/lib/session';

export async function joinBusiness(token: string): Promise<{ error: string }> {
  const u = await requireUser(`/invite/${token}`);
  let slug: string;
  try {
    slug = (await acceptInvite(token, { id: u.id, email: u.email })).slug;
  } catch (err) {
    if (err instanceof InviteError) return { error: (await getT()).text(err.message) };
    throw err;
  }
  redirect(`/w/${slug}/home` as Route);
}
