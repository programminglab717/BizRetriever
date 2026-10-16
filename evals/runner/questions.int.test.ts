import { readFileSync } from 'node:fs';
import path from 'node:path';

import { loadDemoWorkspace, type DemoWorkspace } from '@bizr/core/testing';
import { closePools } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  EVAL_TODAY,
  evalEnv,
  loadQuestionCases,
  questionRegressions,
  runQuestionSuite,
  scoreQuestions,
  type QuestionScores,
} from './questions';

/**
 * The rules-only question evals, run in CI on the demo data (M4 acceptance): the demo script must
 * be answered, clarifications must be warranted, and nothing may regress against the committed
 * baseline. No AI calls; the AI suite runs on demand (`pnpm eval -- --suite questions --ai`).
 */
const hasDb = await databaseAvailable();
const baseline = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../baselines/questions.json'), 'utf8'),
) as { rules?: QuestionScores };

describe.skipIf(!hasDb)('question evals (rules only)', () => {
  let demo: DemoWorkspace;
  beforeAll(async () => {
    demo = await loadDemoWorkspace({ today: EVAL_TODAY, name: 'Fernwood Question Evals' });
  }, 120_000);
  afterAll(async () => {
    await demo?.dispose();
    await closePools();
  });

  it('answers the demo script and doesn’t regress', async () => {
    const env = await evalEnv(demo.member);
    const results = await runQuestionSuite(env, loadQuestionCases(), { provider: null, ai: false });
    const s = scoreQuestions(results);
    const failed = results.filter((r) => !r.passed).map((r) => `${r.id}: ${r.failure}`);
    expect(s.cases).toBeGreaterThanOrEqual(150);
    expect(s.demoAccuracy, failed.join('\n')).toBeGreaterThanOrEqual(0.95);
    expect(s.clarifyPrecision).toBeGreaterThanOrEqual(0.8);
    if (baseline.rules)
      expect(questionRegressions(s, baseline.rules), failed.join('\n')).toEqual([]);
  }, 300_000);
});
