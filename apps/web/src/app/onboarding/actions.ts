'use server';

import { createWorkspace, newWorkspaceSchema } from '@bizr/core/workspaces';
import { getLogger } from '@bizr/platform';
import { redirect } from 'next/navigation';

import { getT } from '@/lib/i18n';
import { requireUser } from '@/lib/session';

export interface OnboardingState {
  fieldErrors?: Partial<Record<'name' | 'packId' | 'currency' | 'timezone' | 'dateOrder', string>>;
  formError?: string;
}

export async function createBusiness(
  _previous: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const user = await requireUser('/onboarding');
  const t = await getT();
  const parsed = newWorkspaceSchema.safeParse({
    name: formData.get('name'),
    packId: formData.get('packId'),
    currency: formData.get('currency'),
    timezone: formData.get('timezone'),
    dateOrder: formData.get('dateOrder'),
    language: formData.get('language') ?? undefined,
  });
  if (!parsed.success) {
    const fieldErrors: OnboardingState['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof NonNullable<OnboardingState['fieldErrors']>;
      fieldErrors[key] ??= t.text(issue.message);
    }
    return { fieldErrors };
  }

  let slug: string;
  try {
    slug = (await createWorkspace(user.id, parsed.data)).slug;
  } catch (err) {
    getLogger('onboarding').error({ err, userId: user.id }, 'workspace creation failed');
    return { formError: t('We couldn’t set up your business just now. Please try again.') };
  }
  redirect(`/w/${slug}/home`);
}
