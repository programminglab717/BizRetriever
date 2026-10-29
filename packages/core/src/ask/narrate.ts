import { AiError, type LLMProvider } from '@bizr/ai';
import {
  explainSql as explainPromptEn,
  explainSqlEs,
  narrateAnswer as narratePromptEn,
  narrateAnswerEs,
} from '@bizr/ai/prompts';
import type { Language } from '@bizr/i18n';
import { getLogger } from '@bizr/platform';
import { z } from 'zod';

import { findJargon, MAX_TEMPLATE_LENGTH, validateTemplate } from '../narration';
import type { AnswerData, AnswerFacts } from './answer';

/**
 * AI Tasks E and F. The AI writes the answer sentence with placeholders only (no numbers, names or
 * dates of its own) and explains fallback SQL in plain steps. Both are checked; whenever the AI is
 * off, over budget or fails the checks twice, code's own wording is used.
 */

export interface NarrateInput {
  question: string;
  data: AnswerData;
  facts: AnswerFacts;
  /** Code's own sentence, used whenever the AI's isn't. */
  fallback: string;
  assumptions: readonly string[];
  provider: LLMProvider | null;
  aiMode?: 'auto' | 'never';
  /** The reader's language (M20): Spanish readers get the Spanish prompt. */
  lang?: Language;
  workspaceId?: string | null;
}

export interface Narration {
  template: string;
  origin: 'ai' | 'template';
  aiCalls: number;
}

const narrationSchema = z.object({ text: z.string().min(1).max(MAX_TEMPLATE_LENGTH) }).strict();
const CAUSAL =
  /\b(because|due to|thanks to|as a result|caused|driven by|so you should|you should)\b/i;
const log = () => getLogger('ask.narrate');

/** Problems with an AI answer template; empty means it's safe to render. */
export function narrationProblems(text: string, facts: Iterable<string>): string[] {
  const problems = validateTemplate(text, facts);
  const sentences = text.split(/[.!?](?:\s|$)/).filter((s) => s.trim()).length;
  if (sentences > 3) problems.push('use at most three sentences');
  if (CAUSAL.test(text))
    problems.push('don’t explain why or give advice; say only what the facts say');
  if (/[*#_`]/.test(text.replace(/\{\{[^}]*\}\}/g, ''))) problems.push('no markdown');
  return problems;
}

function shapeOf(data: AnswerData): 'total' | 'list' | 'over_time' {
  const dims = data.columns.filter((c) => c.kind === 'dimension');
  if (dims.length === 0) return 'total';
  return dims.length === 1 && dims[0]!.time ? 'over_time' : 'list';
}

export async function narrate(input: NarrateInput): Promise<Narration> {
  const template = (aiCalls: number): Narration => ({
    template: input.fallback,
    origin: 'template',
    aiCalls,
  });
  if (!input.provider || input.aiMode === 'never' || input.data.rows.length === 0)
    return template(0);
  const narratePrompt = input.lang === 'es' ? narrateAnswerEs : narratePromptEn;
  const names = Object.keys(input.facts.facts);
  if (names.length === 0) return template(0);

  const built = narratePrompt.build({
    question: input.question,
    shape: shapeOf(input.data),
    measures: input.data.columns.filter((c) => c.kind === 'metric').map((c) => c.label),
    facts: input.facts.meanings,
    assumptions: [...input.assumptions],
  });
  const messages = [...built.messages];
  let calls = 0;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      calls++;
      const res = await input.provider.generate({
        task: narratePrompt.task,
        promptVersion: narratePrompt.version,
        tier: 'fast',
        effort: 'low',
        system: narratePrompt.system,
        cachedContext: built.cachedContext,
        messages: [...messages],
        schema: narrationSchema,
        maxTokens: 600,
        workspaceId: input.workspaceId ?? null,
      });
      const problems = narrationProblems(res.data.text, names);
      if (problems.length === 0)
        return { template: res.data.text.trim(), origin: 'ai', aiCalls: calls };
      log().info({ problems }, 'AI narration rejected');
      messages.push(
        { role: 'assistant', content: JSON.stringify(res.data) },
        {
          role: 'user',
          content: `That text has problems: ${problems.join('; ')}. Write it again following the rules.`,
        },
      );
    }
    return template(calls);
  } catch (err) {
    if (err instanceof AiError) return template(calls);
    throw err;
  }
}

// --- Task F -------------------------------------------------------------------------------------

const stepsSchema = z.object({ steps: z.array(z.string().min(1).max(200)).min(2).max(5) }).strict();

export interface SqlExplanation {
  steps: string[];
  origin: 'ai' | 'template';
}

/** Plain steps for a fallback calculation. `records` maps readable names to what they hold. */
export async function explainFallbackSql(input: {
  sql: string;
  records: Record<string, string>;
  provider: LLMProvider | null;
  aiMode?: 'auto' | 'never';
  /** The reader's language (M20): Spanish readers get the Spanish prompt. */
  lang?: Language;
  workspaceId?: string | null;
}): Promise<SqlExplanation> {
  const used = Object.entries(input.records)
    .filter(([name]) => new RegExp(`\\b${name}\\b`, 'i').test(input.sql))
    .map(([, label]) => label);
  const generic: SqlExplanation = {
    origin: 'template',
    steps: [
      'This needed a custom calculation, written for this question.',
      used.length ? `It reads your ${used.join(', ')}.` : 'It reads only your own records.',
      'It was checked for safety and can only read, never change, your data.',
    ],
  };
  if (!input.provider || input.aiMode === 'never') return generic;
  const explainPrompt = input.lang === 'es' ? explainSqlEs : explainPromptEn;
  try {
    const built = explainPrompt.build({ sql: input.sql, records: input.records });
    const res = await input.provider.generate({
      task: explainPrompt.task,
      promptVersion: explainPrompt.version,
      tier: 'fast',
      effort: 'low',
      system: explainPrompt.system,
      ...built,
      schema: stepsSchema,
      maxTokens: 600,
      workspaceId: input.workspaceId ?? null,
    });
    const ok = res.data.steps.every((s) => !/\d/.test(s) && findJargon(s).length === 0);
    return ok ? { steps: res.data.steps, origin: 'ai' } : generic;
  } catch (err) {
    if (err instanceof AiError) return generic;
    throw err;
  }
}
