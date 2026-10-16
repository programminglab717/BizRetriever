// The active version of each prompt (AI_DESIGN §3.2). Released versions are immutable: to change a
// prompt, add v<N+1> next to it and point this file at it. Eval runs record which version they used.
export { proposeDataModelV1 as proposeDataModel } from './propose_data_model/v1';
export { interpretQuestionV1 as interpretQuestion } from './interpret_question/v1';
export { reviseDataModelV1 as reviseDataModel } from './revise_data_model/v1';
export { summarizeProposalV1 as summarizeProposal } from './summarize_proposal/v1';

export type { ProposeDataModelInput } from './propose_data_model/v1';
export type { AskPackCatalog, InterpretQuestionInput } from './interpret_question/v1';
export type { ReviseDataModelInput } from './revise_data_model/v1';
export type { SummarizeProposalInput } from './summarize_proposal/v1';
export { jsonBlock, workspaceDataBlock } from './shared';
export type { PackCatalog, PromptDef, WorkspaceSettings } from './types';
