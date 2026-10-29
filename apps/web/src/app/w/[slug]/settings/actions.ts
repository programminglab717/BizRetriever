'use server';

import {
  businessSettingsSchema,
  deleteWorkspace,
  newWorkspaceSchema,
  setUserLanguage,
  SettingsLockedError,
  updateWorkspaceDetails,
} from '@bizr/core/workspaces';
import { isLanguage } from '@bizr/i18n';
import { getLogger } from '@bizr/platform';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getT } from '@/lib/i18n';
import { requireEditor, requireWorkspace } from '@/lib/session';
import { formText } from '@/lib/forms';

export interface SettingsState {
  fieldErrors?: Partial<Record<'name' | 'currency' | 'timezone' | 'dateOrder', string>>;
  formError?: string;
  saved?: boolean;
}

export async function updateBusiness(
  slug: string,
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const member = await requireEditor(slug);
  const t = await getT();
  const parsed = businessSettingsSchema.extend({ name: newWorkspaceSchema.shape.name }).safeParse({
    name: formData.get('name'),
    currency: formData.get('currency'),
    timezone: formData.get('timezone'),
    dateOrder: formData.get('dateOrder'),
    language: formData.get('language') ?? undefined,
  });
  if (!parsed.success) {
    const fieldErrors: SettingsState['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof NonNullable<SettingsState['fieldErrors']>;
      fieldErrors[key] ??= t.text(issue.message);
    }
    return { fieldErrors };
  }
  try {
    await updateWorkspaceDetails(member, member.user.id, parsed.data);
  } catch (err) {
    if (err instanceof SettingsLockedError)
      return { fieldErrors: { [err.field]: t.text(err.message) } };
    throw err;
  }
  revalidatePath(`/w/${slug}`, 'layout');
  return { saved: true };
}

export interface DeleteState {
  error?: string;
}

export async function deleteBusiness(
  slug: string,
  _previous: DeleteState,
  formData: FormData,
): Promise<DeleteState> {
  const member = await requireWorkspace(slug);
  const t = await getT();
  if (member.role !== 'owner') return { error: t('Only the owner can delete this business.') };
  if (formText(formData, 'confirm').trim() !== member.workspace.name) {
    return { error: t('Type “{name}” exactly to confirm.', { name: member.workspace.name }) };
  }
  try {
    await deleteWorkspace(member, member.user.id);
  } catch (err) {
    getLogger('settings').error({ err, workspaceId: member.workspace.id }, 'delete failed');
    return { error: t('We couldn’t delete this business just now. Please try again.') };
  }
  redirect('/');
}

/** A person's own language (M20): "" means the business's. It follows them to every business. */
export async function setMyLanguage(slug: string, language: string): Promise<{ ok: boolean }> {
  const member = await requireWorkspace(slug);
  if (language !== '' && !isLanguage(language)) return { ok: false };
  await setUserLanguage(member.user.id, language === '' ? null : language);
  revalidatePath('/', 'layout');
  return { ok: true };
}
