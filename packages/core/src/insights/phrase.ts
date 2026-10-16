import { AiError, type LLMProvider } from '@bizr/ai';
import { phraseInsights as phrasePrompt } from '@bizr/ai/prompts';
import type { FactFormat, PackInsightRule } from '@bizr/packs';
import { getLogger } from '@bizr/platform';
import { z } from 'zod';

import { findJargon } from '../narration';
import { INSIGHT_PLACEHOLDER } from './render';

/**
 * AI Task J (AI_DESIGN §4): optional rewording of an insight's sentence. The AI sees only the pack's
 * template and what kind of value each placeholder holds, never values from the owner's files. Its
 * text must keep exactly the same placeholders and pass the same checks as answer narration; any
 * failure (or no AI) keeps the pack's sentence. The AI never decides *whether* something is shown.
 */

export const MAX_PHRASE_BATCH = 10;
const MAX_LENGTH = 300;
const CAUSAL =
  /\b(because|due to|thanks to|as a result|caused|driven by|so you should|you should|consider)\b/i;
const log = () => getLogger('insights.phrase');

const MEANING: Record<FactFormat, string> = {
  text: 'a name from the owner’s records (a product, customer, channel or reason)',
  money: 'an amount of money',
  number: 'a number',
  integer: 'a whole number',
  percent: 'a percentage',
  points: 'a change in percentage points, with the word "points"',
  days: 'a number of days, with the word "days"',
};

function names(template: string): { values: Set<string>; plurals: Set<string> } {
  const values = new Set<string>();
  const plurals = new Set<string>();
  for (const m of template.matchAll(INSIGHT_PLACEHOLDER))
    (m[2] !== undefined ? plurals : values).add(m[1]!);
  return { values, plurals };
}

/** Problems with a reworded sentence; empty means it can be shown instead of the original. */
export function phrasingProblems(text: string, original: string): string[] {
  const problems: string[] = [];
  const want = names(original.replaceAll('**', ''));
  const got = names(text);
  for (const n of want.values)
    if (!got.values.has(n)) problems.push(`keep the placeholder {{${n}}}`);
  for (const n of got.values)
    if (!want.values.has(n)) problems.push(`unknown placeholder {{${n}}}`);
  for (const n of got.plurals)
    if (!want.values.has(n) && !want.plurals.has(n))
      problems.push(`unknown placeholder {{${n}|…}}`);
  const rest = text.replace(INSIGHT_PLACEHOLDER, ' ');
  if (text.trim() === '') problems.push('the text is empty');
  if (text.length > MAX_LENGTH) problems.push(`keep it under ${MAX_LENGTH} characters`);
  if (/[{}]/.test(rest)) problems.push('a placeholder is malformed (use {{name}})');
  if (/\p{Nd}/u.test(rest)) problems.push('the text contains a number outside a placeholder');
  if (/[<>*#_`]/.test(rest)) problems.push('no markup or markdown');
  if (CAUSAL.test(rest)) problems.push('don’t explain why or give advice');
  if (/!/.test(rest)) problems.push('no exclamation marks');
  if (text.split(/[.?](?:\s|$)/).filter((s) => s.trim()).length > 2)
    problems.push('use at most two sentences');
  const jargon = findJargon(rest);
  if (jargon.length) problems.push(`the text uses technical words: ${jargon.join(', ')}`);
  return problems;
}

/** Puts back the bold the pack sentence gives its placeholders (the product, the customer…). */
export function withPackBold(text: string, original: string): string {
  const bold = new Set<string>();
  original.split('**').forEach((chunk, i) => {
    if (i % 2 === 1) for (const m of chunk.matchAll(INSIGHT_PLACEHOLDER)) bold.add(m[1]!);
  });
  const done = new Set<string>();
  return text.replace(INSIGHT_PLACEHOLDER, (whole: string, name: string, one?: string) => {
    if (one !== undefined || !bold.has(name) || done.has(name)) return whole;
    done.add(name);
    return `**${whole}**`;
  });
}

const outputSchema = z
  .object({
    items: z
      .array(z.object({ id: z.string().max(40), text: z.string().min(1).max(600) }).strict())
      .max(MAX_PHRASE_BATCH),
  })
  .strict();

export interface PhraseRequest {
  id: string;
  rule: PackInsightRule;
}

/**
 * Rewords up to ten insights in one call. Returns the templates that passed the checks (with the
 * pack's bold restored), by id. Never throws on AI trouble: the pack sentences simply stay.
 */
export async function phraseInsights(
  requests: PhraseRequest[],
  provider: LLMProvider | null,
  workspaceId: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const batch = requests.slice(0, MAX_PHRASE_BATCH);
  if (!provider || batch.length === 0) return out;
  const byId = new Map(batch.map((r) => [r.id, r.rule]));
  const built = phrasePrompt.build({
    insights: batch.map(({ id, rule }) => ({
      id,
      topic: rule.label,
      template: rule.template.replaceAll('**', ''),
      facts: Object.entries(rule.facts).map(([name, f]) => ({
        name,
        meaning:
          MEANING['text' in f || 'choose' in f ? 'text' : 'count' in f ? 'integer' : f.format],
      })),
    })),
  });
  try {
    const res = await provider.generate({
      task: phrasePrompt.task,
      promptVersion: phrasePrompt.version,
      tier: 'fast',
      effort: 'low',
      system: phrasePrompt.system,
      cachedContext: built.cachedContext,
      messages: built.messages,
      schema: outputSchema,
      maxTokens: 1_500,
      workspaceId,
    });
    for (const item of res.data.items) {
      const rule = byId.get(item.id);
      if (!rule) continue;
      const text = item.text.trim();
      const problems = phrasingProblems(text, rule.template);
      if (problems.length) {
        log().info({ rule: rule.id, problems }, 'AI phrasing rejected');
        continue;
      }
      out.set(item.id, withPackBold(text, rule.template));
    }
  } catch (err) {
    if (!(err instanceof AiError)) throw err;
  }
  return out;
}
