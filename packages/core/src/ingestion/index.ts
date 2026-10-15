// Ingestion: files → tables → profiles → proposal (rules, then AI) → dry run → records.
export {
  proposeDataModel,
  refineWithDryRun,
  reviseDataModel,
  type ProposalContext,
  type ProposalOrigin,
  type ProposalOutcome,
  type RefinedProposal,
  type RevisionOutcome,
} from './ai-proposal';
export { packCatalog, tablesForAi } from './ai-input';
export { analyzeFiles, type Analysis, type UploadedFile } from './analyze';
export { describeChanges } from './changes';
export { answerToCorrection, applyCorrections, applyEffect, type Correction } from './corrections';
export { dryRunProblems, type DryRunProblem } from './dry-run';
export { proposeHeuristically, type HeuristicResult, type ProfiledSource } from './heuristic';
export {
  materialize,
  type EntitySpec,
  type Issue,
  type MaterializedRecord,
  type MaterializeResult,
  type SourceTable,
} from './materialize';
export * from './proposal';
export {
  deterministicSummary,
  proposalFacts,
  summarizeProposal,
  type SummaryFacts,
} from './summary';
export {
  dropIncompleteTargets,
  effectProblems,
  validateProposal,
  type ProposalProblem,
  type ValidationResult,
} from './validate';
