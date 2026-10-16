import { readFileSync } from 'node:fs';
import path from 'node:path';

import { loadDemoWorkspace, type DemoWorkspace } from '@bizr/core/testing';
import { closePools } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  loadDashboardCases,
  runDashboardCase,
  scoreDashboard,
  type DashboardScores,
} from './dashboard';
import { EVAL_TODAY, evalEnv } from './questions';

/** The rules-only dashboard edit evals, in CI: no unintended edits, no regression. No AI calls. */
const hasDb = await databaseAvailable();
const baseline = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../baselines/dashboard.json'), 'utf8'),
) as { rules?: DashboardScores };

describe.skipIf(!hasDb)('dashboard edit evals (rules only)', () => {
  let demo: DemoWorkspace;
  beforeAll(async () => {
    demo = await loadDemoWorkspace({ today: EVAL_TODAY, name: 'Fernwood Dashboard Evals' });
  }, 120_000);
  afterAll(async () => {
    await demo?.dispose();
    await closePools();
  });

  it('plans the edits it should, and nothing it shouldn’t', async () => {
    const env = await evalEnv(demo.member);
    const results = [];
    for (const c of loadDashboardCases())
      results.push(await runDashboardCase(env, c, { provider: null, ai: false }));
    const s = scoreDashboard(results);
    const failed = results.filter((r) => !r.passed).map((r) => `${r.id}: ${r.failure}`);
    expect(s.cases).toBeGreaterThanOrEqual(40);
    expect(s.unintendedRate, failed.join('\n')).toBe(0);
    if (baseline.rules)
      expect(s.accuracy, failed.join('\n')).toBeGreaterThanOrEqual(baseline.rules.accuracy - 0.02);
  }, 300_000);
});
