import { SPANISH_RULE } from '../shared-es';
import type { PromptDef } from '../types';
import { interpretQuestionV1, type InterpretQuestionInput } from './v1';

/** Task D for Spanish readers (M20): questions in Spanish; what the owner reads, in Spanish. */
export const interpretQuestionV2: PromptDef<InterpretQuestionInput> = {
  task: 'interpret_question',
  version: 'interpret_question@v2',
  system: `${interpretQuestionV1.system}

${SPANISH_RULE}
- The question is usually in Spanish, sometimes mixed with English. The specification itself (ids, fields, codes, presets) is unchanged; only text the owner reads is in Spanish: "assumptions" ("Entendí “ganancia” como ganancia bruta: ventas netas menos lo que te costaron los artículos."), a clarifying "question" and its option "label"s, and an unanswerable "message".
- Values used in filters must be spelled exactly as listed in <workspace_data>, whatever language the question uses.`,
  build: (input) => interpretQuestionV1.build(input),
};
