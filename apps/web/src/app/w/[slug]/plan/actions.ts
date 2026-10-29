'use server';

import { PlanningError, removeGoal, setGoal } from '@bizr/core/planning';
import { getLogger } from '@bizr/platform';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getT } from '@/lib/i18n';
import { requireEditor } from '@/lib/session';

export type Result = { ok: true } | { ok: false; error: string };

/** The page sent something it shouldn't have: it was open from before a change. */
async function outOfDate() {
  const t = await getT();
  return { ok: false as const, error: t('This page is out of date.') };
}

const metric = z.string().regex(/^[a-z][a-z0-9_]{0,60}$/);

async function guard(slug: string, fn: () => Promise<void>): Promise<Result> {
  try {
    await fn();
    revalidatePath(`/w/${slug}/plan`);
    revalidatePath(`/w/${slug}/home`);
    return { ok: true };
  } catch (err) {
    const t = await getT();
    if (err instanceof PlanningError) return { ok: false, error: t.text(err.message) };
    getLogger('planning').error({ err, slug }, 'goal action failed');
    return { ok: false, error: t('Something went wrong. Please try again.') };
  }
}

export async function setGoalAction(
  slug: string,
  metricKey: string,
  target: string,
): Promise<Result> {
  const member = await requireEditor(slug);
  if (!metric.safeParse(metricKey).success) return outOfDate();
  return guard(slug, () => setGoal(member, member.user.id, metricKey, String(target).slice(0, 40)));
}

export async function removeGoalAction(slug: string, metricKey: string): Promise<Result> {
  const member = await requireEditor(slug);
  if (!metric.safeParse(metricKey).success) return outOfDate();
  return guard(slug, () => removeGoal(member, member.user.id, metricKey));
}
