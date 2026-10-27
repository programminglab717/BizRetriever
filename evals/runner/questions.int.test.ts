import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  loadDemoWorkspace,
  loadWholesaleWorkspace,
  type DemoWorkspace,
  type WholesaleWorkspace,
} from '@bizr/core/testing';
import { closePools } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  EVAL_TODAY,
  evalEnv,
  loadQuestionCases,
  questionRegressions,
  questionsFile,
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
afterAll(async () => {
  await closePools();
});
const baseline = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../baselines/questions.json'), 'utf8'),
) as { rules?: QuestionScores; 'wholesale-rules'?: QuestionScores };

describe.skipIf(!hasDb)('question evals (rules only)', () => {
  let demo: DemoWorkspace;
  beforeAll(async () => {
    demo = await loadDemoWorkspace({ today: EVAL_TODAY, name: 'Fernwood Question Evals' });
  }, 120_000);
  afterAll(async () => {
    await demo?.dispose();
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

/** M14: the wholesale pack's questions on its own demo business, rules only. */
describe.skipIf(!hasDb)('wholesale question evals (rules only)', () => {
  let demo: WholesaleWorkspace;
  beforeAll(async () => {
    demo = await loadWholesaleWorkspace({ today: EVAL_TODAY, name: 'Harbour Question Evals' });
  }, 120_000);
  afterAll(async () => {
    await demo?.dispose();
  });

  it('answers at least 85% with rules, all of its demo questions, and doesn’t regress', async () => {
    const env = await evalEnv(demo.member);
    const all = loadQuestionCases(questionsFile('wholesale'));
    const results = await runQuestionSuite(env, all, { provider: null, ai: false, all });
    const s = scoreQuestions(results);
    const failed = results.filter((r) => !r.passed).map((r) => `${r.id}: ${r.failure}`);
    expect(s.cases).toBeGreaterThanOrEqual(50);
    expect(s.accuracy, failed.join('\n')).toBeGreaterThanOrEqual(0.85);
    expect(s.demoAccuracy, failed.join('\n')).toBeGreaterThanOrEqual(0.95);
    const base = baseline['wholesale-rules'];
    if (base) expect(questionRegressions(s, base), failed.join('\n')).toEqual([]);
  }, 300_000);
});
