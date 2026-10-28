'use server';

import {
  dismissDigest,
  dismissInsight,
  InsightError,
  markInsightsSeen,
  saveAlertSetting,
  saveEmailPreferences,
} from '@bizr/core/insights';
import { getLogger } from '@bizr/platform';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { queueInsights } from '@/lib/insights';
import { requireEditor, requireWorkspace } from '@/lib/session';

export type Result = { ok: true } | { ok: false; error: string };

async function guard(slug: string, what: string, fn: () => Promise<void>): Promise<Result> {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    if (err instanceof InsightError) return { ok: false, error: err.message };
    getLogger('insights').error({ err, slug, what }, 'insight action failed');
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

const ids = z.array(z.uuid()).max(100);

/** The cards someone has now seen lose their "New" badge. */
export async function markSeen(slug: string, insightIds: string[]): Promise<Result> {
  const member = await requireWorkspace(slug);
  const parsed = ids.safeParse(insightIds);
  if (!parsed.success) return { ok: false, error: 'This page is out of date.' };
  return guard(slug, 'seen', () => markInsightsSeen(member, parsed.data));
}

export async function dismiss(slug: string, id: string, notUseful: boolean): Promise<Result> {
  const member = await requireEditor(slug);
  if (!z.uuid().safeParse(id).success) return { ok: false, error: 'That insight isn’t here.' };
  return guard(slug, 'dismiss', async () => {
    await dismissInsight(member, member.user.id, id, { notUseful });
    revalidatePath(`/w/${slug}/home`);
    revalidatePath(`/w/${slug}/insights`);
  });
}

export async function hideDigest(slug: string, id: string): Promise<Result> {
  const member = await requireEditor(slug);
  if (!z.uuid().safeParse(id).success) return { ok: false, error: 'That summary isn’t here.' };
  return guard(slug, 'digest', () => dismissDigest(member, id));
}

const settingSchema = z
  .object({
    ruleId: z.string().regex(/^[a-z][a-z0-9_]{0,60}$/),
    enabled: z.boolean(),
    thresholds: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,60}$/), z.number()),
  })
  .strict();

/** Saves one alert's settings, then checks the data again with them. */
export async function saveAlert(slug: string, input: unknown): Promise<Result> {
  const member = await requireEditor(slug);
  const parsed = settingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Please check the numbers.' };
  return guard(slug, 'settings', async () => {
    const { ruleId, ...setting } = parsed.data;
    await saveAlertSetting(member, member.user.id, ruleId, setting);
    await queueInsights(member.workspace.id, 'settings');
    revalidatePath(`/w/${slug}/insights/settings`);
  });
}

const emailPrefsSchema = z
  .object({ weeklySummary: z.boolean(), urgentAlerts: z.boolean(), mentions: z.boolean() })
  .partial()
  .strict();

/** Which insight emails the signed-in person gets from this business. */
export async function saveEmailPrefs(
  slug: string,
  prefs: { weeklySummary?: boolean; urgentAlerts?: boolean; mentions?: boolean },
): Promise<Result> {
  const member = await requireWorkspace(slug);
  const parsed = emailPrefsSchema.safeParse(prefs);
  if (!parsed.success) return { ok: false, error: 'This page is out of date.' };
  return guard(slug, 'email', async () => {
    await saveEmailPreferences(member.workspace.id, member.user.id, parsed.data);
  });
}
