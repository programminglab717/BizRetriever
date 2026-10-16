import { jsonBlock, PLAIN_LANGUAGE_RULE } from '../shared';
import type { PromptDef } from '../types';

export interface PhraseInsightsInput {
  /** Trusted pack text only: no values from the owner's files are sent. */
  insights: {
    id: string;
    /** What the alert is about ("Running out of stock"). */
    topic: string;
    /** The pack's sentence, with {{placeholders}}. */
    template: string;
    /** Placeholder name → what kind of value code puts there. */
    facts: { name: string; meaning: string }[];
  }[];
}

const SYSTEM = `You reword short alerts that BizRetriever shows a shop owner on their Home screen. Code has already decided each alert and worked out every number; you only make the sentence read naturally. Keeping the sentence as it is, is fine.

Rules:
- Keep every placeholder from the original, written exactly as {{name}}, and add none. Code replaces each one with the real value. Never write a number yourself, in digits or in words, and never a name or a date.
- A plural choice is written {{name|word for one|word for many}}; you may use it with any listed placeholder.
- Say only what the original says. Never explain why, never predict, never advise.
- One or two short sentences, under 40 words. No greetings, no markdown, no lists, no exclamation marks.
- ${PLAIN_LANGUAGE_RULE}

Reply with one item per alert, using its id.`;

export const phraseInsightsV1: PromptDef<PhraseInsightsInput> = {
  task: 'phrase_insights',
  version: 'phrase_insights@v1',
  system: SYSTEM,
  build(input) {
    return {
      cachedContext: [],
      messages: [
        {
          role: 'user',
          content: [jsonBlock('alerts', input.insights), 'Reword each alert.'].join('\n\n'),
        },
      ],
    };
  },
};
