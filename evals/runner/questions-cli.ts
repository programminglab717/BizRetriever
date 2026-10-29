import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

import type { LLMProvider } from '@bizr/ai';
import { loadDemoWorkspace, loadWholesaleWorkspace } from '@bizr/core/testing';
import { closePools } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';

import {
  EVAL_TODAY,
  estimateQuestionCostUsd,
  evalEnv,
  loadQuestionCases,
  questionRegressions,
  questionsFile,
  runQuestionSuite,
  scoreQuestions,
  type QuestionScores,
} from './questions';

const root = path.resolve(import.meta.dirname, '..');
const baselinePath = path.join(root, 'baselines', 'questions.json');

/**
 * `pnpm eval -- --suite questions [--pack retail|wholesale] [--case ID] [--limit N] [--demo] [--ai]
 * [--yes] [--update-baseline]`
 */
export async function runQuestionsCli(values: {
  pack?: string | undefined;
  lang?: string | undefined;
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
  const pack = values.pack ?? 'retail';
  if (!['retail', 'wholesale'].includes(pack)) {
    console.error('--pack is retail or wholesale');
    return 1;
  }
  const lang = values.lang ?? 'en';
  if (lang !== 'en' && lang !== 'es') {
    console.error('--lang is en or es');
    return 1;
  }
  const mode = values.ai ? 'ai' : 'rules';
  // Retail's baselines keep their names; other packs' are "<pack>-<mode>", other languages'
  // "<pack>-<lang>-<mode>" (M20).
  const baselineKey =
    lang !== 'en' ? `${pack}-${lang}-${mode}` : pack === 'retail' ? mode : `${pack}-${mode}`;
  const all = loadQuestionCases(questionsFile(pack, lang));
  let cases = all;
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

  console.log(`Loading the ${pack} demo business (today = ${EVAL_TODAY})…`);
  const demo =
    pack === 'wholesale'
      ? await loadWholesaleWorkspace({ today: EVAL_TODAY, name: 'Harbour Question Evals' })
      : await loadDemoWorkspace({ today: EVAL_TODAY, name: 'Fernwood Question Evals' });
  try {
    const env = await evalEnv(demo.member, lang);
    const results = await runQuestionSuite(env, cases, {
      provider,
      ai: values.ai,
      all,
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
    const previous = baselines[baselineKey];
    const full = !values.case && !values.limit && !values.demo;
    const regressed = previous && full ? questionRegressions(scores, previous) : [];
    if (regressed.length > 0)
      console.log(`\nRegressed against the ${mode} baseline: ${regressed.join(', ')}`);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportDir = path.join(root, 'reports');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      path.join(reportDir, `questions-${baselineKey}-${stamp}.json`),
      JSON.stringify({ mode, scores, results }, null, 2),
    );
    writeFileSync(
      path.join(reportDir, `questions-${baselineKey}-${stamp}.md`),
      [
        `# Question eval (${pack}, ${mode}) ${new Date().toISOString()}`,
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
      baselines[baselineKey] = scores;
      writeFileSync(baselinePath, `${JSON.stringify(baselines, null, 2)}\n`);
      console.log(`Updated the ${baselineKey} question baseline.`);
    }
    return regressed.length > 0 ? 1 : 0;
  } finally {
    await demo.dispose();
    await closePools();
  }
}
