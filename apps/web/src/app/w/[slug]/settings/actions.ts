'use server';

import {
  businessSettingsSchema,
  deleteWorkspace,
  newWorkspaceSchema,
  updateWorkspaceDetails,
} from '@bizr/core/workspaces';
import { getLogger } from '@bizr/platform';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireWorkspace } from '@/lib/session';
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
  const member = await requireWorkspace(slug);
  const parsed = businessSettingsSchema.extend({ name: newWorkspaceSchema.shape.name }).safeParse({
    name: formData.get('name'),
    currency: formData.get('currency'),
    timezone: formData.get('timezone'),
    dateOrder: formData.get('dateOrder'),
  });
  if (!parsed.success) {
    const fieldErrors: SettingsState['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof NonNullable<SettingsState['fieldErrors']>;
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors };
  }
  await updateWorkspaceDetails(member, member.user.id, parsed.data);
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
  if (member.role !== 'owner') return { error: 'Only the owner can delete this business.' };
  if (formText(formData, 'confirm').trim() !== member.workspace.name) {
    return { error: `Type “${member.workspace.name}” exactly to confirm.` };
  }
  try {
    await deleteWorkspace(member, member.user.id);
  } catch (err) {
    getLogger('settings').error({ err, workspaceId: member.workspace.id }, 'delete failed');
    return { error: 'We couldn’t delete this business just now. Please try again.' };
  }
  redirect('/');
}
