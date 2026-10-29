'use server';

import { RenameError, renameLabel, type RenameTarget } from '@bizr/core/semantic';
import { getLogger } from '@bizr/platform';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getT } from '@/lib/i18n';
import { requireEditor } from '@/lib/session';

const key = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/);
const label = z.string().max(200);
const targetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('measure'), key, label }),
  z.object({ kind: z.literal('recordType'), key, singular: label, plural: label }),
  z.object({ kind: z.literal('detail'), recordType: key, key, label }),
]);

export async function renameAction(
  slug: string,
  target: RenameTarget,
): Promise<{ error?: string }> {
  const member = await requireEditor(slug);
  const t = await getT();
  const parsed = targetSchema.safeParse(target);
  if (!parsed.success) return { error: t('That name can’t be used.') };
  try {
    await renameLabel(member, member.user.id, parsed.data);
  } catch (err) {
    if (err instanceof RenameError) return { error: t.text(err.message) };
    getLogger('glossary').error({ err }, 'rename failed');
    return { error: t('We couldn’t save that name. Please try again.') };
  }
  revalidatePath(`/w/${slug}/glossary`);
  return {};
}
