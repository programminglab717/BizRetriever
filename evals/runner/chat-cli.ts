import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { LLMProvider } from '@bizr/ai';
import { loadDemoWorkspace } from '@bizr/core/testing';
import { closePools } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';

import {
  loadChangeCases,
  loadRecordCases,
  runChangeCase,
  runRecordCase,
  scoreChat,
  type ChatResult,
  type ChatScores,
} from './chat';
import { EVAL_TODAY } from './questions';

const root = path.resolve(import.meta.dirname, '..');

/** `pnpm eval -- --suite records|changes [--case ID] [--ai] [--update-baseline]` */
export async function runChatCli(
  suite: 'records' | 'changes',
  values: { case?: string | undefined; ai: boolean; 'update-baseline': boolean },
): Promise<number> {
  if (!(await databaseAvailable())) {
    console.log('Chat write evals need the database (docker compose up -d). Skipped.');
    return 0;
  }
  const mode = values.ai ? 'ai' : 'rules';
  const baselinePath = path.join(root, 'baselines', `${suite}.json`);
  const all = suite === 'records' ? loadRecordCases() : loadChangeCases();
  const cases = values.case ? all.filter((c) => c.id === values.case) : all;
  let provider: LLMProvider | null = null;
  if (values.ai) {
    console.log(
      `AI run over ${cases.length} request(s); estimated cost up to $${(cases.length * 0.02).toFixed(2)}.`,
    );
    const { getAiProvider } = await import('@bizr/core/ai');
    provider = getAiProvider();
  }
  const demo = await loadDemoWorkspace({ today: EVAL_TODAY, name: `Fernwood ${suite} evals` });
  try {
    const results: ChatResult[] = [];
    for (const c of cases) {
      const r =
        suite === 'records'
          ? await runRecordCase(demo.member, c as ReturnType<typeof loadRecordCases>[number], {
              provider,
              ai: values.ai,
            })
          : await runChangeCase(demo.member, c as ReturnType<typeof loadChangeCases>[number], {
              provider,
              ai: values.ai,
            });
      results.push(r);
      console.log(
        `${r.passed ? 'PASS' : 'FAIL'}  ${r.id}  (${r.origin})${r.failure ? `\n      ${r.failure}` : ''}`,
      );
    }
    const scores = scoreChat(results);
    console.log('\n', scores);
    let baselines: Partial<Record<string, ChatScores>> = {};
    try {
      baselines = JSON.parse(readFileSync(baselinePath, 'utf8')) as Partial<
        Record<string, ChatScores>
      >;
    } catch {
      // first run
    }
    const previous = baselines[mode];
    const regressed = previous && !values.case && scores.accuracy < previous.accuracy - 0.02;
    if (regressed) console.log(`\nRegressed against the ${mode} baseline (${previous.accuracy}).`);
    if (values['update-baseline'] && !values.case) {
      baselines[mode] = scores;
      writeFileSync(baselinePath, `${JSON.stringify(baselines, null, 2)}\n`);
      console.log(`Updated the ${mode} ${suite} baseline.`);
    }
    return regressed || scores.unintendedRate > 0 ? 1 : 0;
  } finally {
    await demo.dispose();
    await closePools();
  }
}
