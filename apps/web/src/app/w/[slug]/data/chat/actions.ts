'use server';

import {
  applyRecordWrite,
  planRecordWrite,
  recordWritePlanSchema,
  RecordsError,
  undoRecordEdit,
  draftWithRules,
  type WriteOutcome,
} from '@bizr/core/records';
import { loadCatalog } from '@bizr/core/change-plan';
import { changePlanSchema } from '@bizr/core/change-plan';
import {
  makeStructuralChange,
  planChangeWithRules,
  planStructureChange,
  StructureError,
  type ChangeOutcome,
} from '@bizr/core/structure';
import { getLogger } from '@bizr/platform';
import { z } from 'zod';

import { requireWorkspace } from '@/lib/session';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export type ChatPlan =
  { kind: 'record'; outcome: WriteOutcome } | { kind: 'change'; outcome: ChangeOutcome };

/** Words that point at how the records are organised rather than at the records themselves. */
const STRUCTURE =
  /\b(track|tracking|detail|details|column|field|rename|call .+ instead|unlink|allowed|option for|options for|kind of|stop offering|should be an? |whole number|yes\/no)\b|^(?:remove|delete|drop)\s+\S+(?:\s+\S+)?\s+from\s+(?:all\s+|my\s+)?\w+$/i;

async function guard<T>(slug: string, what: string, fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof RecordsError || err instanceof StructureError)
      return { ok: false, error: err.message };
    getLogger('data-chat').error({ err, slug, what }, 'data chat action failed');
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

const planInput = z.object({
  text: z.string().min(1).max(400),
  choices: z.record(z.string().max(200), z.string().regex(/^\d{1,18}$/)).optional(),
});

/** "Change or add by chat": works out whether it's about records or how they're organised. */
export async function planDataRequest(slug: string, input: unknown): Promise<Result<ChatPlan>> {
  const member = await requireWorkspace(slug);
  const parsed = planInput.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: 'Please write what you’d like to add or change.' };
  const { text, choices } = parsed.data;
  return guard(slug, 'plan', async () => {
    const catalog = await loadCatalog(member.workspace.id);
    const today = new Date().toISOString().slice(0, 10);
    // The rules decide when they can read it; otherwise the wording does.
    const structural = draftWithRules(text, catalog, { today })
      ? false
      : planChangeWithRules(text, catalog)
        ? true
        : STRUCTURE.test(text);
    if (structural) return { kind: 'change', outcome: await planStructureChange(member, text) };
    const outcome = await planRecordWrite(member, text, choices ? { choices } : {});
    return { kind: 'record', outcome };
  });
}

export async function addRecords(
  slug: string,
  plan: unknown,
): Promise<Result<{ batchId: string; records: { entity: string; id: string; title: string }[] }>> {
  const member = await requireWorkspace(slug);
  const parsed = recordWritePlanSchema.safeParse(plan);
  if (!parsed.success) return { ok: false, error: 'This card is out of date. Please ask again.' };
  return guard(slug, 'write', () =>
    applyRecordWrite({ member, userId: member.user.id, plan: parsed.data }),
  );
}

export async function undoRecords(
  slug: string,
  batchId: string,
): Promise<Result<{ edits: number }>> {
  const member = await requireWorkspace(slug);
  if (!z.uuid().safeParse(batchId).success) return { ok: false, error: 'There’s nothing to undo.' };
  return guard(slug, 'undo', () => undoRecordEdit(member, batchId));
}

export async function makeChange(
  slug: string,
  plan: unknown,
  confirmation: string,
): Promise<Result<{ version: number }>> {
  const member = await requireWorkspace(slug);
  const parsed = changePlanSchema.safeParse(plan);
  if (!parsed.success) return { ok: false, error: 'This card is out of date. Please ask again.' };
  return guard(slug, 'change', () =>
    makeStructuralChange({
      member,
      userId: member.user.id,
      plan: parsed.data,
      confirmation: confirmation.slice(0, 200),
    }),
  );
}
