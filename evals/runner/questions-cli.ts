import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

import type { LLMProvider } from '@bizr/ai';
import { loadDemoWorkspace } from '@bizr/core/testing';
import { closePools } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';

import {
  EVAL_TODAY,
  estimateQuestionCostUsd,
  evalEnv,
  loadQuestionCases,
  questionRegressions,
  runQuestionSuite,
  scoreQuestions,
  type QuestionScores,
} from './questions';

const root = path.resolve(import.meta.dirname, '..');
const baselinePath = path.join(root, 'baselines', 'questions.json');

/** `pnpm eval -- --suite questions [--case ID] [--limit N] [--demo] [--ai] [--yes] [--update-baseline]` */
export async function runQuestionsCli(values: {
  case?: string | undefined;
  limit?: string | undefined;
  demo?: boolean | undefined;
  ai: boolean;
  yes: boolean;
  'update-baseline': boolean;
}): Promise<number> {
  if (!(await databaseAvailable())) {
    console.log('Question evals need the database (docker compose up -d). Skipped.');
    return 0;
  }
  const mode = values.ai ? 'ai' : 'rules';
  let cases = loadQuestionCases();
  if (values.case) cases = cases.filter((c) => c.id === values.case);
  if (values.demo) cases = cases.filter((c) => c.demo);
  if (values.limit) cases = cases.slice(0, Number(values.limit));
  if (cases.length === 0) {
    console.error('No matching question cases.');
    return 1;
  }

  let provider: LLMProvider | null = null;
  if (values.ai) {
    const estimate = estimateQuestionCostUsd(cases.length);
    console.log(
      `AI run over ${cases.length} question(s); estimated cost up to $${estimate.toFixed(2)}.`,
    );
    if (estimate > 1 && !values.yes) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question('That is more than $1. Continue? [y/N] ');
      rl.close();
      if (answer.trim().toLowerCase() !== 'y') return 0;
    }
    const { getAiProvider } = await import('@bizr/core/ai');
    provider = getAiProvider();
  }

  console.log(`Loading the demo business (today = ${EVAL_TODAY})…`);
  const demo = await loadDemoWorkspace({ today: EVAL_TODAY, name: 'Fernwood Question Evals' });
  try {
    const env = await evalEnv(demo.member);
    const results = await runQuestionSuite(env, cases, {
      provider,
      ai: values.ai,
      onResult: (r) => {
        console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.id}  (${r.origin}, ${r.latencyMs} ms)`);
        if (r.failure) console.log(`      ${r.failure}`);
      },
    });
    const scores = scoreQuestions(results);
    console.log('\n', scores);

    const baselines = JSON.parse(readFileSync(baselinePath, 'utf8')) as Partial<
      Record<string, QuestionScores>
    >;
    const previous = baselines[mode];
    const full = !values.case && !values.limit && !values.demo;
    const regressed = previous && full ? questionRegressions(scores, previous) : [];
    if (regressed.length > 0)
      console.log(`\nRegressed against the ${mode} baseline: ${regressed.join(', ')}`);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportDir = path.join(root, 'reports');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      path.join(reportDir, `questions-${mode}-${stamp}.json`),
      JSON.stringify({ mode, scores, results }, null, 2),
    );
    writeFileSync(
      path.join(reportDir, `questions-${mode}-${stamp}.md`),
      [
        `# Question eval (${mode}) ${new Date().toISOString()}`,
        '',
        '| Metric | Value | Baseline |',
        '|---|---|---|',
        ...(Object.keys(scores) as (keyof QuestionScores)[]).map(
          (k) => `| ${k} | ${scores[k]} | ${previous?.[k] ?? '–'} |`,
        ),
        '',
        ...results.map(
          (r) =>
            `- ${r.passed ? '✅' : '❌'} **${r.id}** “${r.q}” (${r.origin})${r.failure ? `: ${r.failure}` : ''}`,
        ),
        '',
      ].join('\n'),
    );
    if (values['update-baseline']) {
      if (!full) {
        console.error('Run the full suite to update the baseline.');
        return 1;
      }
      baselines[mode] = scores;
      writeFileSync(baselinePath, `${JSON.stringify(baselines, null, 2)}\n`);
      console.log(`Updated the ${mode} question baseline.`);
    }
    return regressed.length > 0 ? 1 : 0;
  } finally {
    await demo.dispose();
    await closePools();
  }
}
