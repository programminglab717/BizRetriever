import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { listCases, noAiProvider, regressions, runIngestCase, score, type Scores } from './ingest';

/**
 * The deterministic part of the ingest evals, run in CI (AI_DESIGN §9): every fixture through the
 * rule-based proposer, scored against its expected.yaml and the committed baseline. No AI calls.
 */
const baseline = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../baselines/ingest.json'), 'utf8'),
) as { rules: Scores };

describe('ingest evals (rules only)', () => {
  it('meets the M2 bar and doesn’t regress', async () => {
    const results = [];
    for (const name of listCases())
      results.push(await runIngestCase(name, { provider: noAiProvider, ai: false }));
    const failures = results
      .filter((r) => !r.passed)
      .map((r) => `${r.name}: ${r.failures.join('; ')}`);
    const s = score(results);
    expect(s.canaryFailures).toBe(0);
    expect(s.mappingF1).toBeGreaterThanOrEqual(0.9);
    expect(results.find((r) => r.name === 'demo-fernwood')?.passed, failures.join('\n')).toBe(true);
    expect(regressions(s, baseline.rules), failures.join('\n')).toEqual([]);
  }, 120_000);
});
