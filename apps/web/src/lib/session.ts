import 'server-only';

import {
  canChange,
  getMemberWorkspace,
  listUserWorkspaces,
  NotAllowedError,
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

/**
 * For server actions that change something: the workspace, only for owners and members. Viewers
 * (M13) are refused here and again in the core service (ADR-062). `role-guards.test.ts` checks that
 * every action uses this or is on its list of actions viewers may use.
 */
export async function requireEditor(
  slug: string,
): Promise<MemberWorkspace & { user: SessionUser }> {
  const member = await requireWorkspace(slug);
  if (!canChange(member.role))
    // i18n-skip: core's message; actions show it through t.text
    throw new NotAllowedError('You can view this business but not change it. Ask the owner.');
  return member;
}

/** Where a signed-in user should land: their first business, or onboarding. */
export async function homePathFor(userId: string): Promise<Route> {
  const workspaces = await listUserWorkspaces(userId);
  const active = workspaces.find((w) => w.workspace.status === 'active');
  return active ? (`/w/${active.workspace.slug}/home` as Route) : '/onboarding';
}

/** For route handlers: the member workspace, or null (never redirects). */
export async function workspaceForApi(slug: string): Promise<MemberWorkspace | null> {
  const s = await getSession();
  if (!s) return null;
  const member = await getMemberWorkspace(slug, s.user.id);
  return member && member.workspace.status === 'active' ? member : null;
}
