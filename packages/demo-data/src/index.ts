import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { simulate } from './simulate';
import { buildTruth, type GroundTruth } from './truth';
import { nextMonthUpdate, type NextMonthTruth } from './next-month';
import { writeFiles, writeOnlineOrdersFile } from './writers';

export type { GroundTruth } from './truth';

export interface GenerateOptions {
  /** The demo's "today" (YYYY-MM-DD). Stories are relative to it, so they always look current. */
  today: string;
  seed?: number;
  outDir: string;
}

/** Writes the messy demo files and `ground_truth.json` to `outDir`. */
export async function generateDemoDataset(options: GenerateOptions): Promise<GroundTruth> {
  const seed = options.seed ?? 42;
  const sim = simulate({ today: options.today, seed });
  const files = await writeFiles(sim, options.outDir, seed);
  const truth = buildTruth(sim, files, seed);
  writeFileSync(path.join(options.outDir, 'ground_truth.json'), JSON.stringify(truth, null, 2));
  return truth;
}

export type { Product } from './catalog';
export type { ReturnRecord, Sale, SaleLine, Simulation } from './simulate';

/**
 * The simulated business behind the demo files, for tests that check computed numbers against what
 * really happened (independently of reading the files).
 */
export function simulateDemo(options: { today: string; seed?: number }) {
  return simulate({ today: options.today, seed: options.seed ?? 42 });
}

export type { NextMonthTruth } from './next-month';

/**
 * Writes next month's "Online orders" workbook (the same business, a month later: new orders, a few
 * cancellations, the oldest orders gone from the export) to `outDir`, for re-upload demos and tests.
 */
export async function generateNextMonthUpdate(
  options: GenerateOptions & { days?: number },
): Promise<NextMonthTruth> {
  const seed = options.seed ?? 42;
  const { sim, truth } = nextMonthUpdate(simulate({ today: options.today, seed }), {
    seed,
    ...(options.days ? { days: options.days } : {}),
  });
  await writeOnlineOrdersFile(sim, options.outDir, seed);
  writeFileSync(path.join(options.outDir, 'next_month_truth.json'), JSON.stringify(truth, null, 2));
  return truth;
}
