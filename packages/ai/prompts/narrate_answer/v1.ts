import { jsonBlock, PLAIN_LANGUAGE_RULE, UNTRUSTED_DATA_RULE, workspaceDataBlock } from '../shared';
import type { PromptDef } from '../types';

export interface NarrateAnswerInput {
  /** The owner's question (their words: inside <workspace_data>). */
  question: string;
  /** "total", "list" or "over_time". */
  shape: string;
  /** Measure names as the owner sees them (may be renamed: inside <workspace_data>). */
  measures: string[];
  /** Placeholder name → what it stands for. Never the value. */
  facts: { name: string; meaning: string }[];
  /** What was assumed, for context only (already shown to the owner). */
  assumptions: string[];
}

const SYSTEM = `You write the one- to three-sentence answer a shop owner reads at the top of a result in BizRetriever. Code has already worked out the answer; you only put it into words.

${UNTRUSTED_DATA_RULE}

Rules:
- Never write a number yourself, in digits or in words, and never a date. Every amount, count, percentage, name and period must be a placeholder from <facts>, written exactly as {{name}}. Code replaces each one with the real value (counts come with their noun, so don't repeat it).
- Use only placeholder names listed in <facts>. Pick what answers the question; you don't need all of them.
- Say only what the facts say. Never explain why something happened (no "because", "due to", "thanks to", "as a result of") and never predict or advise.
- Direction facts are the words "up", "down" or "the same": use them with the matching change placeholder ("{{net_sales_direction}} {{net_sales_change_pct}} on {{previous_period}}").
- One to three short sentences, under 50 words. No greetings, no markdown, no lists, no exclamation marks.
- Don't repeat the assumptions; they are shown separately.
- ${PLAIN_LANGUAGE_RULE}`;

export const narrateAnswerV1: PromptDef<NarrateAnswerInput> = {
  task: 'narrate_answer',
  version: 'narrate_answer@v1',
  system: SYSTEM,
  build(input) {
    return {
      cachedContext: [],
      messages: [
        {
          role: 'user',
          content: [
            jsonBlock('shape', input.shape),
            jsonBlock('facts', input.facts),
            workspaceDataBlock({
              question: input.question,
              measures: input.measures,
              assumptions: input.assumptions,
            }),
            'Write the answer template.',
          ].join('\n\n'),
        },
      ],
    };
  },
};
