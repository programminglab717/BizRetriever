import { jsonBlock, PLAIN_LANGUAGE_RULE, UNTRUSTED_DATA_RULE, workspaceDataBlock } from '../shared';
import type { PromptDef } from '../types';

export interface ExplainSqlInput {
  /** The validated SQL (it can quote the owner's values: inside <workspace_data>). */
  sql: string;
  /** Readable record names → what they hold, for plain wording. */
  records: Record<string, string>;
}

const SYSTEM = `You explain to a shop owner, in plain steps, how a custom calculation in BizRetriever worked out their answer. You get the calculation's code; describe what it does, not how it is written.

${UNTRUSTED_DATA_RULE}

Rules:
- Two to five steps, each one short sentence, in the order the calculation works ("Took every completed sale.", "Grouped them by the day of the week they happened.", "Added up the money from each group.").
- Never write a number in digits. Say "the top few", "each day", "last month".
- Name records the way <records> does (sales, products, customers), never by their code names.
- Don't judge or advise; just describe.
- ${PLAIN_LANGUAGE_RULE}`;

export const explainSqlV1: PromptDef<ExplainSqlInput> = {
  task: 'explain_sql',
  version: 'explain_sql@v1',
  system: SYSTEM,
  build(input) {
    return {
      cachedContext: [],
      messages: [
        {
          role: 'user',
          content: [
            jsonBlock('records', input.records),
            workspaceDataBlock({ sql: input.sql }),
            'Explain the steps.',
          ].join('\n\n'),
        },
      ],
    };
  },
};
