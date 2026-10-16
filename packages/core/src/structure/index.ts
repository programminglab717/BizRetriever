export { describeOp, describePlan, kindName } from './describe';
export {
  analyzeChange,
  listChanges,
  makeStructuralChange,
  previewUndo,
  StructureError,
  undoStructuralChange,
} from './service';
export type { ChangeEntry, ChangeImpact, UndoPreview } from './service';
export { snapshotGcJob } from './gc';
export { CANT_CHANGE, planStructureChange } from './plan';
export type { ChangeOutcome } from './plan';
export { planChangeWithRules } from './plan-rules';
