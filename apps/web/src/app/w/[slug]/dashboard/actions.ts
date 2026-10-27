'use server';

import {
  applyDashboardEdit,
  DashboardEditError,
  dashboardRangeSchema,
  editOpSchema,
  planDashboardEdit,
  saveDashboardRange,
  undoDashboardEdit,
  type DashboardRange,
  type EditOp,
  type PlanOutcome,
} from '@bizr/core/dashboard';
import { getLogger } from '@bizr/platform';
import { z } from 'zod';

import { requireEditor } from '@/lib/session';

/**
 * Dashboard changes. Ops from the browser are never trusted as they are: they're parsed here and
 * every question in them is checked again by `applyDashboardEdit` before anything is saved.
 */

export type EditActionResult = { ok: true; changes: string[] } | { ok: false; error: string };

const log = () => getLogger('dashboard.web');

export async function editAction(slug: string, ops: EditOp[]): Promise<EditActionResult> {
  const member = await requireEditor(slug);
  const parsed = z.array(editOpSchema).min(1).max(6).safeParse(ops);
  if (!parsed.success) return { ok: false, error: 'That change can’t be made.' };
  try {
    const r = await applyDashboardEdit(member, member.user.id, parsed.data);
    return { ok: true, changes: r.changes };
  } catch (err) {
    if (err instanceof DashboardEditError) return { ok: false, error: err.message };
    log().error({ err }, 'dashboard edit failed');
    return { ok: false, error: 'That didn’t save. Please try again.' };
  }
}

export async function undoAction(slug: string): Promise<EditActionResult> {
  const member = await requireEditor(slug);
  try {
    const r = await undoDashboardEdit(member, member.user.id);
    return { ok: true, changes: [`Undid: ${r.undone}`] };
  } catch (err) {
    if (err instanceof DashboardEditError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function saveRangeAction(slug: string, range: DashboardRange): Promise<void> {
  const member = await requireEditor(slug);
  const parsed = dashboardRangeSchema.safeParse(range);
  if (parsed.success) await saveDashboardRange(member, parsed.data);
}

/** Works out (and previews) a change from the owner's words. Saves nothing. */
export async function planAction(
  slug: string,
  request: string,
  tileId?: string,
): Promise<PlanOutcome> {
  const member = await requireEditor(slug);
  const text = z.string().max(300).safeParse(request);
  const tile = z.string().uuid().optional().safeParse(tileId);
  if (!text.success || !tile.success) return { kind: 'none', message: 'Please keep it shorter.' };
  try {
    return await planDashboardEdit(member, text.data, tile.data ? { tileId: tile.data } : {});
  } catch (err) {
    log().error({ err }, 'dashboard plan failed');
    return { kind: 'none', message: 'Something went wrong working that out. Please try again.' };
  }
}
