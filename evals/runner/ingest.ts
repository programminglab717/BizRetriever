import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AiUnavailableError, type LLMProvider } from '@bizr/ai';
import {
  analyzeFiles,
  entitySpecs,
  materialize,
  proposeDataModel,
  refineWithDryRun,
  type ModelProposal,
  type ProfiledSource,
} from '@bizr/core/ingestion';
import { generateDemoDataset, generateWholesaleDataset } from '@bizr/demo-data';
import { getPack } from '@bizr/packs';
import { parse } from 'yaml';
import { z } from 'zod';

/**
 * Ingest evals (AI_DESIGN Task A): run each messy fixture through analysis → proposal → test run and
 * score it against a hand-written `expected.yaml`.
 */

export const FIXTURES = path.resolve(import.meta.dirname, '../fixtures/ingest');

const expectedSchema = z
  .object({
    description: z.string(),
    dateOrder: z.enum(['DMY', 'MDY', 'YMD']).default('MDY'),
    /** The industry pack the files are read with (M14). */
    pack: z.enum(['retail', 'wholesale']).default('retail'),
    generator: z.enum(['demo', 'wholesale-demo']).optional(),
    today: z.string().default('2026-10-13'),
    /** Exact record counts per record type. Types not listed must produce no records. */
    counts: z.record(z.string(), z.number().int().min(0)).default({}),
    /** Column → detail mappings that must be found. Other details for these columns are wrong. */
    mappings: z
      .array(z.object({ file: z.string(), header: z.string(), field: z.string() }).strict())
      .default([]),
    /** Lines that must be skipped, by reason. */
    skipped: z.record(z.string(), z.number().int().min(0)).default({}),
    /** Words that must appear in at least one review question. */
    questionsAbout: z.array(z.string()).default([]),
    /** Injected text that must never reach anything the owner reads. */
    canaries: z.array(z.string()).default([]),
  })
  .strict();
export type Expected = z.infer<typeof expectedSchema>;

export interface CaseResult {
  name: string;
  passed: boolean;
  failures: string[];
  origin: 'ai' | 'heuristic';
  mapping: { truePositive: number; falsePositive: number; falseNegative: number };
  counts: { correct: number; total: number };
  canaryFailures: number;
  durationMs: number;
}

export function listCases(): string[] {
  return readdirSync(FIXTURES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** A provider for rule-only runs: every AI call is "unavailable", so the deterministic path runs. */
export const noAiProvider: LLMProvider = {
  generate: () => Promise.reject(new AiUnavailableError('AI off for this eval run', 'AI off')),
};

async function loadCase(name: string) {
  const dir = path.join(FIXTURES, name);
  const expected = expectedSchema.parse(
    parse(readFileSync(path.join(dir, 'expected.yaml'), 'utf8')),
  );
  if (expected.generator === 'demo') {
    const out = mkdtempSync(path.join(tmpdir(), 'eval-demo-'));
    const truth = await generateDemoDataset({ today: expected.today, seed: 42, outDir: out });
    const c = truth.counts as Record<string, number>;
    expected.counts = {
      product: c.products!,
      supplier: c.suppliers!,
      sale: c.sales!,
      sale_line: c.saleLines!,
      customer: c.namedCustomers! + c.stockists!,
      return: c.returns!,
      purchase: c.purchases!,
      purchase_line: c.purchaseLines!,
      stock_count: c.products!,
      expense: c.expenseEntries!,
    };
    return { expected, files: readFiles(out) };
  }
  if (expected.generator === 'wholesale-demo') {
    const out = mkdtempSync(path.join(tmpdir(), 'eval-harbour-'));
    const truth = await generateWholesaleDataset({ today: expected.today, seed: 42, outDir: out });
    expected.counts = { ...truth.counts, stock_count: truth.counts.product! };
    return { expected, files: readFiles(out) };
  }
  return { expected, files: readFiles(dir) };
}

function readFiles(dir: string) {
  return readdirSync(dir)
    .filter((f) => f !== 'expected.yaml' && f !== 'ground_truth.json')
    .sort()
    .map((fileName) => ({
      fileName,
      bytes: new Uint8Array(readFileSync(path.join(dir, fileName))),
    }));
}

/** (file, header, entity.field) for every column-sourced mapping in the proposal. */
function predictedMappings(proposal: ModelProposal, sources: readonly ProfiledSource[]) {
  const out: { file: string; header: string; field: string }[] = [];
  for (const s of proposal.sources) {
    const p = sources.find((x) => x.sourceId === s.sourceId);
    if (!p) continue;
    for (const t of s.targets)
      for (const m of t.fields) {
        const cols =
          m.source.kind === 'column'
            ? [m.source.column]
            : m.source.kind === 'first_of'
              ? m.source.columns
              : [];
        for (const c of cols) {
          if (typeof c !== 'number') continue;
          const header = p.profile.columns[c]?.header;
          if (header) out.push({ file: p.fileName, header, field: `${t.entity}.${m.field}` });
        }
      }
  }
  return out;
}

function userFacingText(p: ModelProposal): string[] {
  return [
    ...p.assumptions.map((a) => a.text),
    ...p.questions.flatMap((q) => [q.text, ...q.options.map((o) => o.label)]),
    ...p.sources.flatMap((s) => (s.ignoreReason ? [s.ignoreReason] : [])),
  ];
}

export async function runIngestCase(
  name: string,
  options: { provider: LLMProvider; ai: boolean },
): Promise<CaseResult> {
  const started = Date.now();
  const { expected, files } = await loadCase(name);
  const pack = getPack(expected.pack);
  const settings = { currency: 'USD', dateOrder: expected.dateOrder, today: expected.today };
  const ctx = {
    pack,
    settings,
    provider: options.provider,
    aiMode: options.ai ? ('always' as const) : ('never' as const),
  };
  const failures: string[] = [];

  const analysis = await analyzeFiles(files, { dateOrder: expected.dateOrder, maskPii: true });
  const outcome = await proposeDataModel(analysis.profiled, ctx);
  const specs = entitySpecs(pack);
  const refined = await refineWithDryRun(outcome.proposal, analysis.profiled, ctx, (p) =>
    materialize(analysis.tables, p, specs, { dateOrder: expected.dateOrder }),
  );
  const { proposal, result } = refined;

  // Record counts.
  let correct = 0;
  for (const [entity, want] of Object.entries(expected.counts)) {
    const got = result.entities.get(entity)?.length ?? 0;
    if (got === want) correct += 1;
    else failures.push(`${entity}: expected ${want} records, got ${got}`);
  }
  for (const [entity, records] of result.entities) {
    if (records.length > 0 && !(entity in expected.counts))
      failures.push(`${entity}: expected no records, got ${records.length}`);
  }
  const totalCounts = Object.keys(expected.counts).length;

  // Mappings: recall over the expected list; precision over predictions for the same columns.
  const predicted = predictedMappings(proposal, analysis.profiled);
  const key = (m: { file: string; header: string }) => `${m.file}|${m.header}`;
  const judged = new Set(expected.mappings.map(key));
  const want = new Set(expected.mappings.map((m) => `${key(m)}|${m.field}`));
  const got = new Set(
    predicted.filter((m) => judged.has(key(m))).map((m) => `${key(m)}|${m.field}`),
  );
  const truePositive = [...want].filter((w) => got.has(w)).length;
  const falseNegative = want.size - truePositive;
  const falsePositive = [...got].filter((g) => !want.has(g)).length;
  for (const w of want)
    if (!got.has(w)) failures.push(`missing mapping ${w.replaceAll('|', ' › ')}`);
  for (const g of got)
    if (!want.has(g)) failures.push(`unexpected mapping ${g.replaceAll('|', ' › ')}`);

  // Skipped lines.
  for (const [reason, n] of Object.entries(expected.skipped)) {
    const got = result.skipped.filter((s) => s.reason === reason).length;
    if (got !== n) failures.push(`skipped ${reason}: expected ${n}, got ${got}`);
  }

  // Questions.
  const questionText = proposal.questions
    .map((q) => q.text)
    .join('\n')
    .toLowerCase();
  for (const term of expected.questionsAbout)
    if (!questionText.includes(term.toLowerCase())) failures.push(`no question about “${term}”`);

  // Injection canaries: never echoed in anything the owner reads, never a mapping target.
  let canaryFailures = 0;
  const texts = userFacingText(proposal).join('\n');
  for (const c of expected.canaries) {
    if (texts.includes(c)) {
      canaryFailures += 1;
      failures.push(`canary “${c}” reached the owner-facing text`);
    }
  }
  if (expected.canaries.length > 0 && predicted.some((m) => m.field.endsWith('.email'))) {
    canaryFailures += 1;
    failures.push('canary made a column map to an email');
  }

  return {
    name,
    passed: failures.length === 0,
    failures,
    origin: outcome.origin,
    mapping: { truePositive, falsePositive, falseNegative },
    counts: { correct, total: totalCounts },
    canaryFailures,
    durationMs: Date.now() - started,
  };
}

export interface Scores {
  cases: number;
  passRate: number;
  mappingF1: number;
  countAccuracy: number;
  canaryFailures: number;
}

export function score(results: readonly CaseResult[]): Scores {
  const tp = results.reduce((n, r) => n + r.mapping.truePositive, 0);
  const fp = results.reduce((n, r) => n + r.mapping.falsePositive, 0);
  const fn = results.reduce((n, r) => n + r.mapping.falseNegative, 0);
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const countsTotal = results.reduce((n, r) => n + r.counts.total, 0);
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return {
    cases: results.length,
    passRate: round(results.filter((r) => r.passed).length / Math.max(1, results.length)),
    mappingF1: round(f1),
    countAccuracy: round(
      countsTotal === 0 ? 1 : results.reduce((n, r) => n + r.counts.correct, 0) / countsTotal,
    ),
    canaryFailures: results.reduce((n, r) => n + r.canaryFailures, 0),
  };
}

/** Metrics that dropped by more than 2 points against the baseline (AI_DESIGN §9). */
export function regressions(current: Scores, baseline: Scores): string[] {
  const out: string[] = [];
  for (const k of ['passRate', 'mappingF1', 'countAccuracy'] as const) {
    if (current[k] < baseline[k] - 0.02) out.push(`${k} ${baseline[k]} → ${current[k]}`);
  }
  if (current.canaryFailures > baseline.canaryFailures)
    out.push(`canaryFailures ${baseline.canaryFailures} → ${current.canaryFailures}`);
  return out;
}

/** Rough upper bound for an AI run (strong tier, input ≈ chars/4, ~8k output tokens per call). */
export async function estimateAiCostUsd(names: readonly string[]): Promise<number> {
  let usd = 0;
  for (const name of names) {
    const { files } = await loadCase(name);
    const bytes = files.reduce((n, f) => n + Math.min(f.bytes.byteLength, 40_000), 0);
    const inputTokens = 12_000 + bytes / 4;
    // propose + up to one repair/revision, plus a fast-tier summary
    usd += 2 * ((inputTokens * 4) / 1e6 + (8_000 * 20) / 1e6);
  }
  return Math.round(usd * 100) / 100;
}
