import { SPANISH_RULE } from '../shared-es';
import type { PromptDef } from '../types';
import { explainSqlV1, type ExplainSqlInput } from './v1';

/** Task F for Spanish readers (M20): the same steps, written in Spanish. */
export const explainSqlV2: PromptDef<ExplainSqlInput> = {
  task: 'explain_sql',
  version: 'explain_sql@v2',
  system: `${explainSqlV1.system}

${SPANISH_RULE}
- Write the steps in Spanish, in the past tense ("Tomé cada venta completada.", "Las agrupé por día de la semana.", "Sumé el dinero de cada grupo.").`,
  build: (input) => explainSqlV1.build(input),
};
