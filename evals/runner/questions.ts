import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { LLMProvider } from '@bizr/ai';
import {
  estimateRequestWithRules,
  interpret,
  loadAskContext,
  questionSpecSchema,
  toAnswerData,
  toQuerySpec,
  type AnswerData,
  type AskContext,
  type Interpretation,
  type QuestionSpec,
  type Turn,
} from '@bizr/core/ask';
import { executeTenantQuery } from '@bizr/core/executor';
import { planningMetrics } from '@bizr/core/planning';
import { compileQuery, runFallbackSql, type CompileContext } from '@bizr/core/semantic';
import type { MemberWorkspace } from '@bizr/core/workspaces';
import { getPack } from '@bizr/packs';
import { parse } from 'yaml';
import { z } from 'zod';

/**
 * Question evals (AI_DESIGN Task D): each question is interpreted (rules, then AI when enabled) and
 * its answer compared with a hand-written reference spec by RESULT, not by spec, on the seeded demo
 * dataset. Different specs that give the same numbers both count as correct.
 */

export const QUESTIONS_FILE = path.resolve(import.meta.dirname, '../questions/retail.yaml');
/** Each pack's question set (M14): `questions/<pack>.yaml`, on that pack's demo business. */
export const questionsFile = (pack: string) =>
  path.resolve(import.meta.dirname, `../questions/${pack}.yaml`);
export const EVAL_TODAY = '2026-10-13';

const refSchema = questionSpecSchema.partial().extend({ metrics: z.array(z.string()).min(1) });

const caseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    q: z.string().min(2),
    expect: z.enum(['query', 'clarify', 'unanswerable', 'estimate']),
    /** For `estimate` (M12): what the rules should recognise. Omitted parts aren't checked. */
    estimate: z
      .object({
        kind: z.enum(['forecast', 'goal', 'reorder', 'not_estimable']),
        metric: z.string().nullable().optional(),
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
      })
      .strict()
      .optional(),
    /** Part of the investor demo script (must be ≥ 95%). */
    demo: z.boolean().default(false),
    /** The id of the question asked just before, in the same conversation. */
    after: z.string().optional(),
    ref: refSchema.optional(),
    note: z.string().optional(),
  })
  .strict()
  .refine((c) => c.expect !== 'query' || c.ref, { message: 'query cases need a ref' })
  .refine((c) => c.expect !== 'estimate' || c.estimate, {
    message: 'estimate cases need an estimate',
  });
export type QuestionCase = z.infer<typeof caseSchema>;

export function loadQuestionCases(file = QUESTIONS_FILE): QuestionCase[] {
  const raw = parse(readFileSync(file, 'utf8')) as unknown;
  const cases = z.array(caseSchema).parse(raw);
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`duplicate case id ${c.id}`);
    if (c.after && !ids.has(c.after)) throw new Error(`${c.id}: "after" must name an earlier case`);
    ids.add(c.id);
  }
  return cases;
}

export function fullSpec(ref: z.infer<typeof refSchema>): QuestionSpec {
  return questionSpecSchema.parse({
    dimensions: [],
    filters: [],
    having: [],
    timeRange: { preset: 'all_time' },
    ...ref,
  });
}

export interface QuestionResult {
  id: string;
  q: string;
  expect: QuestionCase['expect'];
  got: Interpretation['kind'] | 'estimate';
  origin: string;
  demo: boolean;
  passed: boolean;
  failure?: string;
  aiCalls: number;
  latencyMs: number;
}

export interface QuestionScores {
  cases: number;
  /** Share of all cases answered correctly. */
  accuracy: number;
  /** Share of query cases with the right numbers. */
  executionAccuracy: number;
  /** Share of forward-looking questions recognised as such, with the right measure and dates. */
  estimateAccuracy: number;
  demoAccuracy: number;
  /** Of the clarifying questions asked, how many were expected. */
  clarifyPrecision: number;
  clarifyRecall: number;
  /** Share answered by the rules alone (no AI). */
  rulesRate: number;
  p95LatencyMs: number;
}

export interface EvalEnv {
  member: MemberWorkspace;
  ctx: AskContext;
  compile: CompileContext;
}

export async function evalEnv(member: MemberWorkspace): Promise<EvalEnv> {
  const ctx = await loadAskContext(member);
  const s = member.settings;
  const compile: CompileContext = {
    timezone: s.timezone,
    weekStart: s.weekStart,
    fiscalYearStartMonth: s.fiscalYearStartMonth,
    today: EVAL_TODAY,
  };
  ctx.catalog.calendar = {
    today: EVAL_TODAY,
    weekStart: s.weekStart,
    fiscalYearStartMonth: s.fiscalYearStartMonth,
  };
  return { member, ctx, compile };
}

export async function runSpec(env: EvalEnv, spec: QuestionSpec): Promise<AnswerData> {
  const ws = env.member.workspace;
  const q = compileQuery(env.ctx.model, toQuerySpec(spec, env.ctx.catalog.calendar), env.compile);
  const r = await executeTenantQuery({
    tenant: { workspaceId: ws.id, tenantSchema: ws.tenantSchema },
    sql: q.sql,
    params: q.params,
    origin: 'system',
    path: 'spec',
    timeoutMs: 20_000,
  });
  return toAnswerData({ columns: q.columns, rows: r.rows, truncated: r.truncated });
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * 1e-6);

/** Why `got` doesn't give the reference's numbers, or null when it does. */
export function compareResults(
  ref: AnswerData,
  refSpec: QuestionSpec,
  got: AnswerData,
): string | null {
  const dimId = (c: AnswerData['columns'][number]) => c.field ?? `time:${c.time}`;
  const refDims = ref.columns.filter((c) => c.kind === 'dimension');
  const gotDims = got.columns.filter((c) => c.kind === 'dimension');
  const gotByDim = refDims.map((d) => gotDims.find((g) => dimId(g) === dimId(d)));
  if (gotByDim.some((g) => !g) || gotDims.length !== refDims.length)
    return `broken down by [${gotDims.map(dimId).join(', ')}], expected [${refDims.map(dimId).join(', ')}]`;

  const refVals = ref.columns.filter((c) => c.kind !== 'dimension');
  const pairs = refVals.map((c) => ({
    ref: c,
    got: got.columns.find((g) => g.kind === c.kind && g.metric === c.metric),
  }));
  const missing = pairs.find((p) => !p.got);
  if (missing)
    return `no ${missing.ref.kind === 'previous' ? 'comparison for ' : ''}${missing.ref.metric}`;

  const keyOf = (row: Record<string, unknown>, cols: ((typeof refDims)[number] | undefined)[]) =>
    cols.map((c) => String(row[c!.key])).join(' | ');
  let gotRows = got.rows;
  if (refSpec.limit) {
    const primary = pairs.find((p) => p.ref.metric === (refSpec.orderBy?.by ?? refSpec.metrics[0]));
    const dir = refSpec.orderBy?.dir === 'asc' ? 1 : -1;
    if (primary)
      gotRows = [...got.rows]
        .filter((r) => r[primary.got!.key] !== null)
        .sort((a, b) => dir * (Number(a[primary.got!.key]) - Number(b[primary.got!.key])))
        .slice(0, refSpec.limit);
  }
  if (gotRows.length !== ref.rows.length)
    return `${gotRows.length} rows, expected ${ref.rows.length}`;

  const gotMap = new Map(gotRows.map((r) => [keyOf(r, gotByDim), r]));
  const valueOf = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const mismatches: string[] = [];
  for (const r of ref.rows) {
    const k = keyOf(r, refDims);
    const g = gotMap.get(k);
    if (!g) {
      mismatches.push(`missing row ${k}`);
      continue;
    }
    for (const p of pairs) {
      const a = valueOf(g[p.got!.key]);
      const b = valueOf(r[p.ref.key]);
      if (a === null || b === null ? a !== b : !close(a, b))
        mismatches.push(`${k} ${p.ref.key}: ${a} vs ${b}`);
    }
  }
  if (mismatches.length === 0) return null;
  // Ties at the cut-off of a top-N list: the same values with different names still count.
  if (refSpec.limit && mismatches.every((m) => m.startsWith('missing row'))) {
    const vals = (rows: Record<string, unknown>[], key: string) =>
      rows.map((r) => valueOf(r[key])).sort((x, y) => (x ?? 0) - (y ?? 0));
    const p = pairs[0]!;
    const a = vals(gotRows, p.got!.key);
    const b = vals(ref.rows, p.ref.key);
    if (a.every((v, i) => v !== null && b[i] !== null && close(v, b[i]!))) return null;
  }
  return mismatches.slice(0, 3).join('; ');
}

export async function runQuestionCase(
  env: EvalEnv,
  c: QuestionCase,
  history: Turn[],
  options: { provider: LLMProvider | null; ai: boolean },
): Promise<{ result: QuestionResult; interpretation: Interpretation | null }> {
  const started = Date.now();
  const ws = env.member.workspace;
  // As Ask does: questions about what's ahead are recognised first (ADR-061).
  const est = estimateRequestWithRules(c.q, env.ctx.catalog, planningMetrics(ws.packId));
  if (est) {
    const want = c.estimate;
    const period = est.kind === 'forecast' ? est.period : undefined;
    const metric = 'metric' in est ? est.metric : undefined;
    const failure =
      c.expect !== 'estimate'
        ? `answered "estimate", expected "${c.expect}"`
        : want!.kind !== est.kind
          ? `recognised "${est.kind}", expected "${want!.kind}"`
          : want!.metric !== undefined && want!.metric !== metric
            ? `measure ${String(metric)}, expected ${String(want!.metric)}`
            : (want!.from && want!.from !== period?.from) || (want!.to && want!.to !== period?.to)
              ? `dates ${period?.from}–${period?.to}, expected ${want!.from}–${want!.to}`
              : undefined;
    return {
      interpretation: null,
      result: {
        id: c.id,
        q: c.q,
        expect: c.expect,
        got: 'estimate',
        origin: 'rules',
        demo: c.demo,
        passed: !failure,
        ...(failure ? { failure } : {}),
        aiCalls: 0,
        latencyMs: Date.now() - started,
      },
    };
  }
  const out = await interpret({
    question: c.q,
    catalog: env.ctx.catalog,
    model: env.ctx.model,
    compile: env.compile,
    pack: getPack(ws.packId),
    tenantSchema: ws.tenantSchema,
    history,
    provider: options.provider,
    aiMode: options.ai ? 'auto' : 'never',
    workspaceId: ws.id,
  });
  const i = out.interpretation;
  let failure: string | undefined;
  if (c.expect === 'query') {
    if (i.kind === 'query') {
      try {
        const spec = fullSpec(c.ref!);
        const [ref, got] = await Promise.all([runSpec(env, spec), runSpec(env, i.spec)]);
        failure = compareResults(ref, spec, got) ?? undefined;
      } catch (err) {
        failure = `failed to run: ${err instanceof Error ? err.message : String(err)}`;
      }
    } else if (i.kind === 'sql') {
      const run = await runFallbackSql(ws, i.sql);
      failure = run.ok ? 'answered with custom SQL (not compared)' : `SQL refused: ${run.reason}`;
    } else failure = `answered "${i.kind}", expected an answer`;
  } else if (i.kind !== c.expect) failure = `answered "${i.kind}", expected "${c.expect}"`;
  // (An `estimate` case that reached here wasn't recognised as one: the line above reports it.)

  return {
    interpretation: i,
    result: {
      id: c.id,
      q: c.q,
      expect: c.expect,
      got: i.kind,
      origin: out.origin,
      demo: c.demo,
      passed: !failure,
      ...(failure ? { failure } : {}),
      aiCalls: out.aiCalls,
      latencyMs: Date.now() - started,
    },
  };
}

/** Runs cases in order; `after` cases get the earlier case's question and meaning as history. */
export async function runQuestionSuite(
  env: EvalEnv,
  cases: QuestionCase[],
  options: {
    provider: LLMProvider | null;
    ai: boolean;
    onResult?: (r: QuestionResult) => void;
    /** Every case of the set, for follow-ups (`after`); the retail set by default. */
    all?: QuestionCase[];
  },
): Promise<QuestionResult[]> {
  const meanings = new Map<string, Turn>();
  const all = options.all ?? loadQuestionCases();
  const results: QuestionResult[] = [];
  for (const c of cases) {
    const history: Turn[] = [];
    for (let id = c.after; id; id = all.find((x) => x.id === id)?.after) {
      let turn = meanings.get(id);
      if (!turn) {
        const prev = all.find((x) => x.id === id)!;
        const interpretation = (await runQuestionCase(env, prev, [], options)).interpretation;
        if (!interpretation) continue;
        turn = { question: prev.q, interpretation };
        meanings.set(id, turn);
      }
      history.unshift(turn);
    }
    const { result, interpretation } = await runQuestionCase(env, c, history, options);
    if (interpretation) meanings.set(c.id, { question: c.q, interpretation });
    results.push(result);
    options.onResult?.(result);
  }
  return results;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function scoreQuestions(results: QuestionResult[]): QuestionScores {
  const rate = (xs: QuestionResult[]) =>
    xs.length ? round(xs.filter((r) => r.passed).length / xs.length) : 1;
  const asked = results.filter((r) => r.got === 'clarify');
  const wanted = results.filter((r) => r.expect === 'clarify');
  const lat = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    cases: results.length,
    accuracy: rate(results),
    executionAccuracy: rate(results.filter((r) => r.expect === 'query')),
    estimateAccuracy: rate(results.filter((r) => r.expect === 'estimate')),
    demoAccuracy: rate(results.filter((r) => r.demo)),
    clarifyPrecision: asked.length
      ? round(asked.filter((r) => r.expect === 'clarify').length / asked.length)
      : 1,
    clarifyRecall: wanted.length
      ? round(wanted.filter((r) => r.got === 'clarify').length / wanted.length)
      : 1,
    rulesRate: round(
      results.filter((r) => r.origin === 'rules').length / Math.max(1, results.length),
    ),
    p95LatencyMs: lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] ?? 0,
  };
}

/** Score keys where a drop of more than 2 points against the baseline is a regression. */
export function questionRegressions(now: QuestionScores, base: QuestionScores): string[] {
  return (['accuracy', 'executionAccuracy', 'demoAccuracy', 'clarifyPrecision'] as const).filter(
    (k) => now[k] < base[k] - 0.02,
  );
}

/** Upper bound for an AI run: every case falls through to the AI with a repair and escalation. */
export function estimateQuestionCostUsd(cases: number): number {
  return cases * 0.03;
}
