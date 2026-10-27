import { AiError, type LLMProvider } from '@bizr/ai';
import { planChange as prompt } from '@bizr/ai/prompts';
import { getLogger } from '@bizr/platform';
import { z } from 'zod';

import { getAiProvider } from '../ai/runtime';
import { loadCatalog } from '../change-plan/apply';
import { ChangePlanError, compileChangePlan } from '../change-plan/compile';
import { changePlanSchema, type ChangePlan } from '../change-plan/schema';
import { findJargon } from '../narration';
import { recordCatalog } from '../records/write-plan';
import { requireEditor, type MemberWorkspace } from '../workspaces/service';
import { planChangeWithRules } from './plan-rules';
import { analyzeChange, listChanges, StructureError, type ChangeImpact } from './service';

/**
 * "Change what you track" (Task I): rules first, then the AI. Every plan is compiled and its impact
 * counted by code before the owner sees it; a removal is only ever planned when the owner asked to
 * remove, unlink or change something.
 */

export type ChangeOutcome =
  | {
      kind: 'plan';
      plan: ChangePlan;
      impact: ChangeImpact;
      explanation: string | null;
      origin: 'rules' | 'ai';
    }
  | { kind: 'clarify'; question: string }
  | { kind: 'none'; message: string };

export const CANT_CHANGE =
  'I couldn’t work out that change. Try “Track which salesperson made each sale”, “Rename selling price to RRP” or “Remove brand from products”.';

/** Words that make a removal a plausible reading of the request. */
const REMOVING =
  /\b(remove|delete|drop|get rid|stop|unlink|no longer|don'?t (?:need|want|track)|change|make|turn|convert|should be)\b/i;

const aiAnswerSchema = z
  .object({
    plan: z.object({ ops: changePlanSchema.shape.ops.element.array().max(20) }).strict(),
    explanation: z.string().max(400).default(''),
    questions: z.array(z.string().max(200)).max(3).optional(),
  })
  .strict();

const log = () => getLogger('structure.plan');

function problemsOf(
  member: MemberWorkspace,
  catalog: Awaited<ReturnType<typeof loadCatalog>>,
  plan: ChangePlan,
  request: string,
): string[] {
  try {
    const c = compileChangePlan(member.workspace.tenantSchema, catalog, plan);
    if (c.destructive && !REMOVING.test(request))
      return ['the owner did not ask to remove or change anything; plan only what they asked'];
    return [];
  } catch (err) {
    if (err instanceof ChangePlanError) return err.problems;
    return ['the plan is not valid'];
  }
}

export async function planStructureChange(
  member: MemberWorkspace,
  request: string,
  options: { provider?: LLMProvider | null; aiMode?: 'auto' | 'never' } = {},
): Promise<ChangeOutcome> {
  requireEditor(member);
  const text = request.trim().slice(0, 400);
  if (!text) return { kind: 'none', message: CANT_CHANGE };
  const catalog = await loadCatalog(member.workspace.id);
  const draft = planChangeWithRules(text, catalog);
  if (draft && 'clarify' in draft) return { kind: 'clarify', question: draft.clarify };
  if (draft && 'refuse' in draft) return { kind: 'none', message: draft.refuse };
  let plan: ChangePlan | null =
    draft && 'plan' in draft && problemsOf(member, catalog, draft.plan, text).length === 0
      ? draft.plan
      : null;
  let origin: 'rules' | 'ai' = 'rules';
  let explanation: string | null = null;
  if (!plan) {
    const provider = options.provider === undefined ? getAiProvider() : options.provider;
    if (provider && options.aiMode !== 'never') {
      const out = await planWithAi(member, catalog, text, provider);
      if (out && 'question' in out) return { kind: 'clarify', question: out.question };
      if (out) {
        plan = out.plan;
        explanation = out.explanation;
        origin = 'ai';
      }
    }
  }
  if (!plan) return { kind: 'none', message: CANT_CHANGE };
  try {
    return { kind: 'plan', plan, impact: await analyzeChange(member, plan), explanation, origin };
  } catch (err) {
    if (err instanceof StructureError) return { kind: 'none', message: err.message };
    throw err;
  }
}

async function planWithAi(
  member: MemberWorkspace,
  catalog: Awaited<ReturnType<typeof loadCatalog>>,
  request: string,
  provider: LLMProvider,
): Promise<{ plan: ChangePlan; explanation: string | null } | { question: string } | null> {
  const history = (await listChanges(member, 10)).map((c) => c.steps.join('; '));
  let last: { answer: unknown; problems: string[] } | undefined;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const built = prompt.build({
        catalog: recordCatalog(catalog),
        history,
        ...(last ? { lastAnswer: last.answer, problems: last.problems } : {}),
        request,
      });
      const res = await provider.generate({
        task: prompt.task,
        promptVersion: prompt.version,
        tier: 'standard',
        effort: 'low',
        system: prompt.system,
        ...built,
        schema: aiAnswerSchema,
        maxTokens: 3_000,
        workspaceId: member.workspace.id,
      });
      const answer = res.data;
      if (answer.plan.ops.length === 0)
        return answer.questions?.[0] ? { question: answer.questions[0] } : null;
      const plan: ChangePlan = { ops: answer.plan.ops };
      const problems = problemsOf(member, catalog, plan, request);
      if (problems.length === 0) {
        const explanation =
          answer.explanation &&
          !findJargon(answer.explanation).length &&
          !/\d/.test(answer.explanation)
            ? answer.explanation
            : null;
        return { plan, explanation };
      }
      log().info({ problems }, 'AI change plan rejected');
      last = { answer, problems };
    }
    return null;
  } catch (err) {
    if (err instanceof AiError) return null;
    throw err;
  }
}
