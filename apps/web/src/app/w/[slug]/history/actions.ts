'use server';

import {
  previewUndo,
  StructureError,
  undoStructuralChange,
  type UndoPreview,
} from '@bizr/core/structure';
import { getLogger } from '@bizr/platform';
import { z } from 'zod';

import { getT } from '@/lib/i18n';
import { withInsights } from '@/lib/insights';
import { requireEditor, requireWorkspace } from '@/lib/session';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const version = z.number().int().min(1).max(1_000_000);

async function guard<T>(slug: string, fn: () => Promise<T>): Promise<Result<T>> {
  const t = await getT();
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof StructureError) return { ok: false, error: t.text(err.message) };
    getLogger('history').error({ err, slug }, 'history action failed');
    return { ok: false, error: t('Something went wrong. Please try again.') };
  }
}

/** What undoing a change would do, before anything happens. */
export async function checkUndo(slug: string, v: number): Promise<Result<UndoPreview>> {
  const member = await requireWorkspace(slug);
  const t = await getT();
  if (!version.safeParse(v).success)
    return { ok: false, error: t('We couldn’t find that change.') };
  return guard(slug, () => previewUndo(member, v));
}

export async function undoChange(
  slug: string,
  v: number,
  confirmed: boolean,
): Promise<Result<{ version: number }>> {
  const member = await requireEditor(slug);
  const t = await getT();
  if (!version.safeParse(v).success)
    return { ok: false, error: t('We couldn’t find that change.') };
  return guard(slug, () =>
    withInsights(member.workspace.id, 'structure_change', () =>
      undoStructuralChange({ member, userId: member.user.id, version: v, confirmed }),
    ),
  );
}
