import { readFileSync } from 'node:fs';
import path from 'node:path';

import { loadDemoWorkspace, type DemoWorkspace } from '@bizr/core/testing';
import { closePools } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  loadChangeCases,
  loadRecordCases,
  runChangeCase,
  runRecordCase,
  scoreChat,
  type ChatScores,
} from './chat';
import { EVAL_TODAY } from './questions';

/** The rules-only chat write evals, in CI: nothing unintended, no regression. No AI calls. */
const hasDb = await databaseAvailable();
const baseline = (suite: string) => {
  try {
    return (
      JSON.parse(
        readFileSync(path.resolve(import.meta.dirname, `../baselines/${suite}.json`), 'utf8'),
      ) as {
        rules?: ChatScores;
      }
    ).rules;
  } catch {
    return undefined;
  }
};

describe.skipIf(!hasDb)('chat write evals (rules only)', () => {
  let demo: DemoWorkspace;
  beforeAll(async () => {
    demo = await loadDemoWorkspace({ today: EVAL_TODAY, name: 'Fernwood Chat Evals' });
  }, 120_000);
  afterAll(async () => {
    await demo?.dispose();
    await closePools();
  });

  it('plans record writes (≥ 40 cases)', async () => {
    const results = [];
    for (const c of loadRecordCases())
      results.push(await runRecordCase(demo.member, c, { provider: null, ai: false }));
    const s = scoreChat(results);
    const failed = results.filter((r) => !r.passed).map((r) => `${r.id}: ${r.failure}`);
    expect(s.cases).toBeGreaterThanOrEqual(40);
    expect(s.unintendedRate, failed.join('\n')).toBe(0);
    const b = baseline('records');
    if (b) expect(s.accuracy, failed.join('\n')).toBeGreaterThanOrEqual(b.accuracy - 0.02);
  }, 300_000);

  it('plans changes (≥ 30 cases), never removing for an additive request', async () => {
    const results = [];
    for (const c of loadChangeCases())
      results.push(await runChangeCase(demo.member, c, { provider: null, ai: false }));
    const s = scoreChat(results);
    const failed = results.filter((r) => !r.passed).map((r) => `${r.id}: ${r.failure}`);
    expect(s.cases).toBeGreaterThanOrEqual(30);
    expect(s.unintendedRate, failed.join('\n')).toBe(0);
    const b = baseline('changes');
    if (b) expect(s.accuracy, failed.join('\n')).toBeGreaterThanOrEqual(b.accuracy - 0.02);
  }, 300_000);
});
