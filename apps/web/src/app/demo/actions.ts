'use server';

import { startDemoShop } from '@bizr/core/demo';
import { getLogger } from '@bizr/platform';
import type { Route } from 'next';
import { redirect } from 'next/navigation';

import { getLanguage, getT } from '@/lib/i18n';
import { kickJobs } from '@/lib/imports';
import { getJobQueue } from '@/lib/jobs';
import { requireUser } from '@/lib/session';

export interface DemoState {
  error?: string;
}

/**
 * "Try the demo shop": a fresh Fernwood Home & Gift with today's messy files, imported live so the
 * person sees exactly what happens with their own files. Replaces their previous demo shop.
 */
export async function tryDemoShop(_previous: DemoState, _form: FormData): Promise<DemoState> {
  const user = await requireUser('/onboarding');
  let target: Route;
  try {
    const { member, runId } = await startDemoShop({
      userId: user.id,
      queue: await getJobQueue(),
      language: await getLanguage(),
    });
    kickJobs();
    target = `/w/${member.workspace.slug}/data/import/${runId}` as Route;
  } catch (err) {
    getLogger('demo').error({ err, userId: user.id }, 'demo shop failed');
    const t = await getT();
    return { error: t('We couldn’t set up the demo shop just now. Please try again.') };
  }
  redirect(target);
}
