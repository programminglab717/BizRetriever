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
