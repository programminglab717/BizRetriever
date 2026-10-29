'use server';

import {
  answerView,
  askQuestion,
  AskError,
  FEEDBACK_REASONS,
  pinAnswer,
  setAnswerFeedback,
  unpinTile,
  type AnswerView,
} from '@bizr/core/ask';
import { getLogger } from '@bizr/platform';
import { z } from 'zod';

import { viewOptions } from '@/lib/ask';
import { getT } from '@/lib/i18n';
import { requireEditor, requireWorkspace } from '@/lib/session';

const uuid = z.string().uuid();
const askInput = z.object({
  question: z.string().max(500),
  conversationId: uuid.optional(),
  choice: z.object({ answerId: uuid, option: z.number().int().min(0).max(3) }).optional(),
});

export type AskActionResult =
  { ok: true; conversationId: string; answer: AnswerView } | { ok: false; error: string };

const log = () => getLogger('ask.web');

export async function askAction(
  slug: string,
  input: z.input<typeof askInput>,
): Promise<AskActionResult> {
  const member = await requireWorkspace(slug);
  const t = await getT();
  const parsed = askInput.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: t('That question couldn’t be sent. Please try again.') };
  try {
    const r = await askQuestion(member, member.user.id, parsed.data, { lang: t.lang });
    return {
      ok: true,
      conversationId: r.conversationId,
      answer: answerView(r, viewOptions(member, t.lang)),
    };
  } catch (err) {
    if (err instanceof AskError) return { ok: false, error: t.text(err.message) };
    log().error({ err }, 'ask failed');
    return { ok: false, error: t('Something went wrong working that out. Please try again.') };
  }
}

export async function feedbackAction(
  slug: string,
  answerId: string,
  value: 1 | -1 | null,
  reason?: string,
): Promise<{ error?: string }> {
  const member = await requireWorkspace(slug);
  const t = await getT();
  const id = uuid.safeParse(answerId);
  const r = z.enum(FEEDBACK_REASONS).optional().safeParse(reason);
  if (!id.success || !r.success || ![1, -1, null].includes(value))
    return { error: t('That didn’t save.') };
  try {
    await setAnswerFeedback(member, id.data, value, r.data);
    return {};
  } catch (err) {
    if (err instanceof AskError) return { error: t.text(err.message) };
    throw err;
  }
}

// No revalidatePath here: the dashboard renders per request, and revalidating would refresh (and
// reset) the Ask screen the owner is on.
export async function pinAction(
  slug: string,
  answerId: string,
): Promise<{ tileId?: string; error?: string }> {
  const member = await requireEditor(slug);
  const t = await getT();
  const id = uuid.safeParse(answerId);
  if (!id.success) return { error: t('That can’t be added.') };
  try {
    const tileId = await pinAnswer(member, id.data);
    return { tileId };
  } catch (err) {
    if (err instanceof AskError) return { error: t.text(err.message) };
    throw err;
  }
}

export async function unpinAction(slug: string, tileId: string): Promise<{ error?: string }> {
  const member = await requireEditor(slug);
  const t = await getT();
  const id = uuid.safeParse(tileId);
  if (!id.success) return { error: t('That can’t be removed.') };
  await unpinTile(member, id.data);
  return {};
}
