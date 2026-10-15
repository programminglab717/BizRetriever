import { jsonBlock, PLAIN_LANGUAGE_RULE } from '../shared';
import type { PromptDef } from '../types';

export interface SummarizeProposalInput {
  /** Placeholder name → what it stands for, e.g. product_count → "number of products, with the word". */
  facts: { name: string; meaning: string }[];
  /** Assumption texts, for tone and context only. */
  assumptions: string[];
  questionsToAnswer: boolean;
}

const SYSTEM = `You write the first message a shop owner reads after uploading their spreadsheets to BizRetriever: a short, warm summary of what we found in their files.

Rules:
- Write two or three short sentences, under 60 words in total.
- Never write a number yourself, in digits or in words. Every count or amount must be a placeholder from <facts>, written exactly as {{name}}. Code replaces each placeholder with the real value, including its noun ("412 products"), so don't repeat the noun after a count placeholder.
- Use only placeholder names listed in <facts>. You don't have to use all of them; pick what matters most to a shop owner (products, sales, customers first).
- If there are questions to answer, end by saying a few things need a quick look.
- No greetings, no exclamation marks, no markdown.
- ${PLAIN_LANGUAGE_RULE}`;

export const summarizeProposalV1: PromptDef<SummarizeProposalInput> = {
  task: 'summarize_proposal',
  version: 'summarize_proposal@v1',
  system: SYSTEM,
  build(input) {
    return {
      cachedContext: [],
      messages: [
        {
          role: 'user',
          content: [
            jsonBlock('facts', input.facts),
            jsonBlock('assumptions', input.assumptions),
            jsonBlock('questions_to_answer', input.questionsToAnswer),
            'Write the summary template.',
          ].join('\n\n'),
        },
      ],
    };
  },
};
