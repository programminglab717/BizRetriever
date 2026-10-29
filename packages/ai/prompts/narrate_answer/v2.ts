import { SPANISH_RULE } from '../shared-es';
import type { PromptDef } from '../types';
import { narrateAnswerV1, type NarrateAnswerInput } from './v1';

/** Task E for Spanish readers (M20): v1's rules, answered in Spanish. */
export const narrateAnswerV2: PromptDef<NarrateAnswerInput> = {
  task: 'narrate_answer',
  version: 'narrate_answer@v2',
  system: `${narrateAnswerV1.system}

${SPANISH_RULE}
- Direction facts are the Spanish words "más", "menos" or "igual": use them with the matching change placeholder ("Es un {{net_sales_change_pct}} {{net_sales_direction}} que en {{previous_period}}.").
- Period placeholders are already in Spanish ("septiembre de 2026"): write "en {{period}}".`,
  build: (input) => narrateAnswerV1.build(input),
};
