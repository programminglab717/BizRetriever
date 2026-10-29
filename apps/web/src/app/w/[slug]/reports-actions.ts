'use server';

import {
  createReport,
  listReports,
  ReportError,
  updateReport,
  type ReportInput,
  type ReportView,
} from '@bizr/core/reports';
import { getLogger } from '@bizr/platform';
import { z } from 'zod';

import { getT } from '@/lib/i18n';
import { requireWorkspace } from '@/lib/session';

/** Scheduled reports (M15): each person sets up, pauses and deletes their own. */

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** The page sent something it shouldn't have: it was open from before a change. */
async function outOfDate() {
  const t = await getT();
  return { ok: false as const, error: t('This page is out of date.') };
}

async function guard<T>(slug: string, fn: () => Promise<T>): Promise<Result<T>> {
  try {
    // No page refresh: the cards keep their own state, and Alert settings reads fresh each visit.
    return { ok: true, data: await fn() };
  } catch (err) {
    const t = await getT();
    if (err instanceof ReportError) return { ok: false, error: t.text(err.message) };
    getLogger('reports').error({ err, slug }, 'report action failed');
    return { ok: false, error: t('Something went wrong. Please try again.') };
  }
}

export async function createReportAction(
  slug: string,
  input: ReportInput,
): Promise<Result<ReportView>> {
  const member = await requireWorkspace(slug);
  return guard(slug, () => createReport(member, member.user.id, input));
}

export async function listReportsAction(slug: string): Promise<Result<ReportView[]>> {
  const member = await requireWorkspace(slug);
  return guard(slug, () => listReports(member, member.user.id));
}

export async function updateReportAction(
  slug: string,
  id: string,
  change: { paused: boolean } | 'delete',
): Promise<Result<null>> {
  const member = await requireWorkspace(slug);
  if (!z.uuid().safeParse(id).success) return outOfDate();
  const c = change === 'delete' ? 'delete' : { paused: Boolean(change.paused) };
  return guard(slug, async () => {
    await updateReport(member, member.user.id, id, c);
    return null;
  });
}
