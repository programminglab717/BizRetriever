import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { LLMProvider } from '@bizr/ai';
import { questionSpecSchema } from '@bizr/core/ask';
import { currentDashboard, planDashboardEdit, type EditOp, type Tile } from '@bizr/core/dashboard';
import { parse } from 'yaml';
import { z } from 'zod';

import { compareResults, fullSpec, runSpec, type EvalEnv } from './questions';

/**
 * Dashboard edit evals (AI_DESIGN Task G): each request is planned against the demo's default
 * dashboard and its edits compared with the expected ones. Added tiles are compared by result;
 * any edit that wasn't expected counts as an unintended change.
 */

export const DASHBOARD_FILE = path.resolve(import.meta.dirname, '../dashboard/retail.yaml');

const refSchema = questionSpecSchema.partial().extend({ metrics: z.array(z.string()).min(1) });
const expectedOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add_tile'), ref: refSchema, chart: z.string().optional() }).strict(),
  z.object({ op: z.literal('remove_tile'), tile: z.string() }).strict(),
  z
    .object({
      op: z.literal('update_tile'),
      tile: z.string(),
      title: z.string().optional(),
      chart: z.string().optional(),
      grain: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
      fixedDates: z.boolean().optional(),
      /** The tile's size should change (any size). */
      size: z.literal(true).optional(),
    })
    .strict(),
  z
    .object({ op: z.literal('move_tile'), tile: z.string(), position: z.enum(['top', 'bottom']) })
    .strict(),
]);

const caseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    request: z.string().min(2),
    expect: z.enum(['plan', 'clarify', 'none']),
    ops: z.array(expectedOp).default([]),
    note: z.string().optional(),
  })
  .strict()
  .refine((c) => c.expect !== 'plan' || c.ops.length > 0, { message: 'plan cases need ops' });
export type DashboardCase = z.infer<typeof caseSchema>;

export function loadDashboardCases(file = DASHBOARD_FILE): DashboardCase[] {
  const cases = z.array(caseSchema).parse(parse(readFileSync(file, 'utf8')));
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`duplicate case id ${c.id}`);
    ids.add(c.id);
  }
  return cases;
}

export interface DashboardResult {
  id: string;
  request: string;
  expect: DashboardCase['expect'];
  got: 'plan' | 'clarify' | 'none';
  origin: string;
  passed: boolean;
  /** An edit was made that the request didn't ask for. */
  unintended: boolean;
  failure?: string;
}

async function matchOp(
  env: EvalEnv,
  want: z.infer<typeof expectedOp>,
  got: EditOp,
  tiles: readonly Tile[],
): Promise<string | null> {
  if (want.op !== got.op) return `${got.op} instead of ${want.op}`;
  const tile = (key: string) => tiles.find((t) => t.packKey === key);
  if (want.op === 'add_tile' && got.op === 'add_tile') {
    if (want.chart && got.chart !== want.chart)
      return `chart ${got.chart ?? 'by shape'}, expected ${want.chart}`;
    const ref = fullSpec(want.ref);
    // A tile that follows the dashboard's dates is compared over the reference's dates.
    const spec = got.fixedDates ? got.spec : { ...got.spec, timeRange: ref.timeRange };
    if (
      Boolean(got.fixedDates) !==
      !('preset' in ref.timeRange && ref.timeRange.preset === 'all_time')
    )
      return got.fixedDates
        ? 'kept its own dates, expected to follow the dashboard'
        : 'didn’t keep the dates asked for';
    try {
      const [a, b] = await Promise.all([runSpec(env, ref), runSpec(env, spec)]);
      return compareResults(a, ref, b);
    } catch (err) {
      return `failed to run: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  if ('tile' in want && 'tileId' in got) {
    const target = tile(want.tile);
    if (!target || got.tileId !== target.id) return `changed the wrong tile`;
  }
  if (want.op === 'update_tile' && got.op === 'update_tile') {
    if (want.title && got.title !== want.title)
      return `title “${got.title}”, expected “${want.title}”`;
    if (want.chart && got.chart !== want.chart) return `chart ${got.chart}, expected ${want.chart}`;
    if (want.grain) {
      const t = tile(want.tile)!;
      const grain = got.spec?.dimensions.find((d) => 'time' in d);
      if (!grain || !('time' in grain) || grain.time !== want.grain)
        return `not shown by ${want.grain}`;
      const rest = (s: Tile['spec']) =>
        JSON.stringify({ ...s, dimensions: s.dimensions.filter((d) => !('time' in d)) });
      if (rest(got.spec!) !== rest(t.spec)) return 'changed more than the time breakdown';
    }
    if (want.fixedDates !== undefined && got.fixedDates !== want.fixedDates)
      return 'dates not changed';
    if (want.size && !got.size) return 'size not changed';
    // Nothing else may change.
    const extra = (['title', 'chart', 'spec', 'size', 'fixedDates'] as const).filter(
      (k) =>
        got[k] !== undefined &&
        !(k === 'spec' && want.grain) &&
        want[k as keyof typeof want] === undefined,
    );
    if (extra.length) return `also changed ${extra.join(', ')}`;
  }
  if (want.op === 'move_tile' && got.op === 'move_tile' && got.position !== want.position)
    return `moved to ${JSON.stringify(got.position)}, expected ${want.position}`;
  return null;
}

export async function runDashboardCase(
  env: EvalEnv,
  c: DashboardCase,
  options: { provider: LLMProvider | null; ai: boolean },
): Promise<DashboardResult> {
  const { tiles } = await currentDashboard(env.member);
  const out = await planDashboardEdit(env.member, c.request, {
    provider: options.provider,
    aiMode: options.ai ? 'auto' : 'never',
  });
  const base = {
    id: c.id,
    request: c.request,
    expect: c.expect,
    got: out.kind,
    origin: out.kind === 'plan' ? out.origin : out.kind,
  };
  if (out.kind !== c.expect)
    return {
      ...base,
      passed: false,
      unintended: out.kind === 'plan',
      failure: `${out.kind}, expected ${c.expect}`,
    };
  if (out.kind !== 'plan') return { ...base, passed: true, unintended: false };
  if (out.ops.length !== c.ops.length)
    return {
      ...base,
      passed: false,
      unintended: out.ops.length > c.ops.length,
      failure: `${out.ops.length} edits, expected ${c.ops.length}`,
    };
  for (let i = 0; i < c.ops.length; i++) {
    const why = await matchOp(env, c.ops[i]!, out.ops[i]!, tiles);
    if (why)
      return {
        ...base,
        passed: false,
        unintended: /also changed|wrong tile/.test(why),
        failure: why,
      };
  }
  return { ...base, passed: true, unintended: false };
}

export interface DashboardScores {
  cases: number;
  accuracy: number;
  /** Share of cases where an edit nobody asked for was proposed. */
  unintendedRate: number;
  rulesRate: number;
}

export function scoreDashboard(results: DashboardResult[]): DashboardScores {
  const r = (n: number) => Math.round((n / Math.max(1, results.length)) * 1000) / 1000;
  return {
    cases: results.length,
    accuracy: r(results.filter((x) => x.passed).length),
    unintendedRate: r(results.filter((x) => x.unintended).length),
    rulesRate: r(results.filter((x) => x.origin === 'rules').length),
  };
}
