/**
 * `pnpm eval [--suite ingest|questions|dashboard|all] [--case NAME] [--limit N] [--demo] [--ai] [--yes]
 * [--update-baseline]`
 *
 * Without `--ai` the suite runs the rule-based proposer only: free and offline. With `--ai` it calls
 * the real AI (through replay recordings when they exist), which costs money: the run prints an
 * estimate and asks before spending more than $1 unless `--yes` is given (CLAUDE.md, ADR-027).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

import type { LLMProvider } from '@bizr/ai';

import {
  estimateAiCostUsd,
  listCases,
  noAiProvider,
  regressions,
  runIngestCase,
  score,
  type CaseResult,
  type Scores,
} from './ingest';

const { values } = parseArgs({
  // `pnpm eval -- --x` passes the `--` through.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    case: { type: 'string' },
    limit: { type: 'string' },
    ai: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    'update-baseline': { type: 'boolean', default: false },
    suite: { type: 'string', default: 'all' },
    demo: { type: 'boolean', default: false },
  },
});

const suite = values.suite ?? 'all';
if (!['ingest', 'questions', 'dashboard', 'all'].includes(suite)) {
  console.error('--suite is ingest, questions, dashboard or all');
  process.exit(1);
}
if (suite === 'dashboard') {
  const { runDashboardCli } = await import('./dashboard-cli');
  process.exit(await runDashboardCli(values));
}
if (suite === 'questions') {
  const { runQuestionsCli } = await import('./questions-cli');
  process.exit(await runQuestionsCli(values));
}

const root = path.resolve(import.meta.dirname, '..');
const baselinePath = path.join(root, 'baselines', 'ingest.json');
const mode = values.ai ? 'ai' : 'rules';

let names = listCases();
if (values.case) names = names.filter((n) => n === values.case);
if (values.limit) names = names.slice(0, Number(values.limit));
if (names.length === 0) {
  console.error('No matching cases.');
  process.exit(1);
}

let provider: LLMProvider = noAiProvider;
if (values.ai) {
  const estimate = await estimateAiCostUsd(names);
  console.log(`AI run over ${names.length} case(s); estimated cost up to $${estimate.toFixed(2)}.`);
  if (estimate > 1 && !values.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('That is more than $1. Continue? [y/N] ');
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') process.exit(0);
  }
  const { getAiProvider } = await import('@bizr/core/ai');
  provider = getAiProvider();
}

const results: CaseResult[] = [];
for (const name of names) {
  const r = await runIngestCase(name, { provider, ai: values.ai });
  results.push(r);
  console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${name}  (${r.origin}, ${r.durationMs} ms)`);
  for (const f of r.failures) console.log(`      ${f}`);
}

const scores = score(results);
console.log('\n', scores);

const baselines = JSON.parse(readFileSync(baselinePath, 'utf8')) as Partial<Record<string, Scores>>;
const previous = baselines[mode];
const full = !values.case && !values.limit;
const regressed = previous && full ? regressions(scores, previous) : [];
if (regressed.length > 0)
  console.log(`\nRegressed against the ${mode} baseline: ${regressed.join(', ')}`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const reportDir = path.join(root, 'reports');
mkdirSync(reportDir, { recursive: true });
writeFileSync(
  path.join(reportDir, `ingest-${mode}-${stamp}.json`),
  JSON.stringify({ mode, scores, results }, null, 2),
);
writeFileSync(
  path.join(reportDir, `ingest-${mode}-${stamp}.md`),
  [
    `# Ingest eval (${mode}) ${new Date().toISOString()}`,
    '',
    `| Metric | Value | Baseline |`,
    `|---|---|---|`,
    ...(['passRate', 'mappingF1', 'countAccuracy', 'canaryFailures'] as const).map(
      (k) => `| ${k} | ${scores[k]} | ${previous?.[k] ?? '–'} |`,
    ),
    '',
    ...results.map(
      (r) =>
        `- ${r.passed ? '✅' : '❌'} **${r.name}** (${r.origin})${r.failures.length ? `: ${r.failures.join('; ')}` : ''}`,
    ),
    '',
  ].join('\n'),
);

if (values['update-baseline']) {
  if (!full) {
    console.error('Run the full suite to update the baseline.');
    process.exit(1);
  }
  baselines[mode] = scores;
  writeFileSync(baselinePath, `${JSON.stringify(baselines, null, 2)}\n`);
  console.log(`Updated the ${mode} baseline.`);
}
let code = regressed.length > 0 ? 1 : 0;
if (suite === 'all' && !values.case) {
  console.log('\n--- Questions ---');
  const { runQuestionsCli } = await import('./questions-cli');
  code = Math.max(code, await runQuestionsCli(values));
  console.log('\n--- Dashboard edits ---');
  const { runDashboardCli } = await import('./dashboard-cli');
  code = Math.max(code, await runDashboardCli(values));
}
process.exit(code);
