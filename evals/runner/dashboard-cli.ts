import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { LLMProvider } from '@bizr/ai';
import { loadDemoWorkspace } from '@bizr/core/testing';
import { closePools } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';

import {
  loadDashboardCases,
  runDashboardCase,
  scoreDashboard,
  type DashboardScores,
} from './dashboard';
import { EVAL_TODAY, evalEnv } from './questions';

const root = path.resolve(import.meta.dirname, '..');
const baselinePath = path.join(root, 'baselines', 'dashboard.json');

/** `pnpm eval -- --suite dashboard [--case ID] [--ai] [--update-baseline]` */
export async function runDashboardCli(values: {
  case?: string | undefined;
  ai: boolean;
  'update-baseline': boolean;
}): Promise<number> {
  if (!(await databaseAvailable())) {
    console.log('Dashboard evals need the database (docker compose up -d). Skipped.');
    return 0;
  }
  const mode = values.ai ? 'ai' : 'rules';
  let cases = loadDashboardCases();
  if (values.case) cases = cases.filter((c) => c.id === values.case);
  let provider: LLMProvider | null = null;
  if (values.ai) {
    console.log(
      `AI run over ${cases.length} edit(s); estimated cost up to $${(cases.length * 0.02).toFixed(2)}.`,
    );
    const { getAiProvider } = await import('@bizr/core/ai');
    provider = getAiProvider();
  }
  const demo = await loadDemoWorkspace({ today: EVAL_TODAY, name: 'Fernwood Dashboard Evals' });
  try {
    const env = await evalEnv(demo.member);
    const results = [];
    for (const c of cases) {
      const r = await runDashboardCase(env, c, { provider, ai: values.ai });
      results.push(r);
      console.log(
        `${r.passed ? 'PASS' : 'FAIL'}  ${r.id}  (${r.origin})${r.failure ? `\n      ${r.failure}` : ''}`,
      );
    }
    const scores = scoreDashboard(results);
    console.log('\n', scores);
    const baselines = JSON.parse(readFileSync(baselinePath, 'utf8')) as Partial<
      Record<string, DashboardScores>
    >;
    const previous = baselines[mode];
    const regressed = previous && !values.case && scores.accuracy < previous.accuracy - 0.02;
    if (regressed) console.log(`\nRegressed against the ${mode} baseline (${previous.accuracy}).`);
    if (values['update-baseline'] && !values.case) {
      baselines[mode] = scores;
      writeFileSync(baselinePath, `${JSON.stringify(baselines, null, 2)}\n`);
      console.log(`Updated the ${mode} dashboard baseline.`);
    }
    return regressed || scores.unintendedRate > 0 ? 1 : 0;
  } finally {
    await demo.dispose();
    await closePools();
  }
}
