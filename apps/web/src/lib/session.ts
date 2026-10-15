import 'server-only';

import {
  getMemberWorkspace,
  listUserWorkspaces,
  type MemberWorkspace,
} from '@bizr/core/workspaces';
import type { Route } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

import { getAuth } from './auth';

export const getSession = cache(async () => {
  return getAuth().api.getSession({ headers: await headers() });
});

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getSession>>>['user'];

/** The signed-in user, or a redirect to sign-in. */
export async function requireUser(next?: string): Promise<SessionUser> {
  const s = await getSession();
  if (!s) redirect(next ? (`/sign-in?next=${encodeURIComponent(next)}` as Route) : '/sign-in');
  return s.user;
}

/**
 * The workspace for a URL slug, only if the signed-in user is an active member (otherwise 404, so
 * we never reveal whether a business exists). Every workspace page and server action calls this.
 */
export const requireWorkspace = cache(
  async (slug: string): Promise<MemberWorkspace & { user: SessionUser }> => {
    const u = await requireUser(`/w/${slug}/home`);
    const member = await getMemberWorkspace(slug, u.id);
    if (!member || member.workspace.status !== 'active') notFound();
    return { ...member, user: u };
  },
);

/** Where a signed-in user should land: their first business, or onboarding. */
export async function homePathFor(userId: string): Promise<Route> {
  const workspaces = await listUserWorkspaces(userId);
  const active = workspaces.find((w) => w.workspace.status === 'active');
  return active ? (`/w/${active.workspace.slug}/home` as Route) : '/onboarding';
}
