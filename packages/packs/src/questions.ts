import { z } from 'zod';

import type { PackMetrics } from './metrics';

/** Example questions (VERTICAL_PACKS §2.8): suggestion chips in Ask, and the demo-script subset. */
export const packQuestionSchema = z
  .object({
    text: z.string().min(3).max(120),
    group: z.string().min(1),
    /** Measures it needs; the chip is hidden when any isn't available. */
    needs: z.array(z.string()).default([]),
  })
  .strict();
export type PackQuestion = z.infer<typeof packQuestionSchema>;

export const packQuestionsFileSchema = z
  .object({ examples: z.array(packQuestionSchema).min(1) })
  .strict();

export function checkQuestions(metrics: PackMetrics, questions: readonly PackQuestion[]): string[] {
  const ids = new Set(metrics.metrics.map((m) => m.id));
  return questions.flatMap((q) =>
    q.needs.filter((id) => !ids.has(id)).map((id) => `"${q.text}" needs unknown measure "${id}"`),
  );
}
