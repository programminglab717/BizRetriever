// The active version of each prompt (AI_DESIGN §3.2). Released versions are immutable: to change a
// prompt, add v<N+1> next to it and point this file at it. Eval runs record which version they used.
export { proposeDataModelV1 as proposeDataModel } from './propose_data_model/v1';
export { explainSqlV1 as explainSql } from './explain_sql/v1';
export { interpretQuestionV1 as interpretQuestion } from './interpret_question/v1';
export { narrateAnswerV1 as narrateAnswer } from './narrate_answer/v1';
export { planDashboardEditV1 as planDashboardEdit } from './plan_dashboard_edit/v1';
export { planRecordWriteV1 as planRecordWrite } from './plan_record_write/v1';
export { planChangeV1 as planChange } from './plan_change/v1';
export { phraseInsightsV1 as phraseInsights } from './phrase_insights/v1';
export { reviseDataModelV1 as reviseDataModel } from './revise_data_model/v1';
export { summarizeProposalV1 as summarizeProposal } from './summarize_proposal/v1';

export type { ProposeDataModelInput } from './propose_data_model/v1';
export type { ExplainSqlInput } from './explain_sql/v1';
export type { AskPackCatalog, InterpretQuestionInput } from './interpret_question/v1';
export type { NarrateAnswerInput } from './narrate_answer/v1';
export type { PlanDashboardEditInput } from './plan_dashboard_edit/v1';
export type { PlanRecordWriteInput, RecordCatalog } from './plan_record_write/v1';
export type { PlanChangeInput } from './plan_change/v1';
export type { PhraseInsightsInput } from './phrase_insights/v1';
export type { ReviseDataModelInput } from './revise_data_model/v1';
export type { SummarizeProposalInput } from './summarize_proposal/v1';
export { jsonBlock, workspaceDataBlock } from './shared';
export type { PackCatalog, PromptDef, WorkspaceSettings } from './types';
