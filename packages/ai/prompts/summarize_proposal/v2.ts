import { SPANISH_RULE } from '../shared-es';
import type { PromptDef } from '../types';
import { summarizeProposalV1, type SummarizeProposalInput } from './v1';

/** The import summary for Spanish readers (M20). */
export const summarizeProposalV2: PromptDef<SummarizeProposalInput> = {
  task: 'summarize_proposal',
  version: 'summarize_proposal@v2',
  system: `${summarizeProposalV1.system}

${SPANISH_RULE}
- Example: "Encontramos {{product_count}} y {{sale_count}} en tus archivos. Hay algunas cosas que conviene revisar rápido."`,
  build: (input) => summarizeProposalV1.build(input),
};
