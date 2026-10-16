import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { LLMProvider } from '@bizr/ai';
import { loadCatalog } from '@bizr/core/change-plan';
import { executeTenantQuery } from '@bizr/core/executor';
import { planRecordWrite, titleFieldOf, type RecordWritePlan } from '@bizr/core/records';
import { ident } from '@bizr/core/sql';
import { planStructureChange } from '@bizr/core/structure';
import type { MemberWorkspace } from '@bizr/core/workspaces';
import { normalizeLoose } from '@bizr/ingest';
import { parse } from 'yaml';
import { z } from 'zod';

import { EVAL_TODAY } from './questions';

/**
 * Chat write evals: record writes (Task H) and change plans (Task I) on the demo business. Plans
 * are compared on what they would write; nothing is applied.
 */

export const RECORDS_FILE = path.resolve(import.meta.dirname, '../records/retail.yaml');
export const CHANGES_FILE = path.resolve(import.meta.dirname, '../changes/retail.yaml');
const NOW = new Date(`${EVAL_TODAY}T16:00:00Z`);

const scalar = z.union([z.string(), z.number(), z.boolean()]);
const recordCase = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    request: z.string().min(1),
    expect: z.enum(['plan', 'clarify', 'none']),
    operation: z.enum(['insert', 'update']).optional(),
    entity: z.string().optional(),
    values: z.record(z.string(), scalar).default({}),
    links: z.record(z.string(), z.string()).default({}),
    lines: z
      .array(
        z
          .object({ product: z.string(), quantity: z.number(), unit_price: z.number().optional() })
          .strict(),
      )
      .default([]),
    target: z.string().optional(),
    total: z.number().optional(),
    note: z.string().optional(),
  })
  .strict();
export type RecordCase = z.infer<typeof recordCase>;

const changeCase = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    request: z.string().min(1),
    expect: z.enum(['plan', 'clarify', 'none']),
    destructive: z.boolean().optional(),
    ops: z.array(z.record(z.string(), z.unknown())).default([]),
    note: z.string().optional(),
  })
  .strict();
export type ChangeCase = z.infer<typeof changeCase>;

function load<T extends { id: string }>(file: string, schema: z.ZodType<T>): T[] {
  const cases = z.array(schema).parse(parse(readFileSync(file, 'utf8')));
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`duplicate case id ${c.id}`);
    ids.add(c.id);
  }
  return cases;
}
export const loadRecordCases = (file = RECORDS_FILE) => load(file, recordCase);
export const loadChangeCases = (file = CHANGES_FILE) => load(file, changeCase);

export interface ChatResult {
  id: string;
  expect: 'plan' | 'clarify' | 'none';
  got: 'plan' | 'clarify' | 'none';
  origin: string;
  passed: boolean;
  /** Record writes: wrote something not asked for. Changes: removed data for an additive request. */
  unintended: boolean;
  failure?: string;
}

const same = (want: unknown, got: unknown): boolean => {
  if (typeof want === 'number') return Number(got) === want;
  if (typeof want === 'boolean') return got === want || String(got) === String(want);
  return (
    normalizeLoose(String(want)) ===
    normalizeLoose(
      typeof got === 'string' || typeof got === 'number' || typeof got === 'boolean'
        ? String(got)
        : '',
    )
  );
};

async function titleOf(
  member: MemberWorkspace,
  entity: string,
  id: string,
): Promise<string | null> {
  const catalog = await loadCatalog(member.workspace.id);
  const e = catalog.find((x) => x.key === entity);
  const t = e ? titleFieldOf(e.fields) : undefined;
  if (!e || !t) return null;
  const r = await executeTenantQuery({
    tenant: { workspaceId: member.workspace.id, tenantSchema: member.workspace.tenantSchema },
    sql: `SELECT ${ident(t)}::text AS t FROM ${ident(e.tableName)} WHERE "_id" = $1::bigint`,
    params: [id],
    origin: 'system',
    path: 'system',
  });
  return (r.rows[0]?.t as string | undefined) ?? null;
}

async function linkTitle(
  member: MemberWorkspace,
  target: string,
  ref: RecordWritePlan['records'][number]['references'][string],
): Promise<string | null> {
  if ('candidateId' in ref) return titleOf(member, target, ref.candidateId);
  const v = Object.values(ref.createNew.values)[0];
  return v === undefined || v === null ? null : `new:${String(v)}`;
}

export async function runRecordCase(
  member: MemberWorkspace,
  c: RecordCase,
  options: { provider: LLMProvider | null; ai: boolean },
): Promise<ChatResult> {
  const out = await planRecordWrite(member, c.request, {
    provider: options.provider,
    aiMode: options.ai ? 'auto' : 'never',
    now: NOW,
  });
  const base = {
    id: c.id,
    expect: c.expect,
    got: out.kind,
    origin: out.kind === 'plan' ? out.origin : out.kind,
  };
  const fail = (failure: string, unintended = false): ChatResult => ({
    ...base,
    passed: false,
    unintended,
    failure,
  });
  if (out.kind !== c.expect)
    return fail(
      `${out.kind}${out.kind === 'none' ? ` (${out.message})` : ''}, expected ${c.expect}`,
      out.kind === 'plan',
    );
  if (out.kind !== 'plan') return { ...base, passed: true, unintended: false };
  const plan = out.plan;
  if (c.operation && plan.operation !== c.operation)
    return fail(`${plan.operation}, expected ${c.operation}`);
  if (c.entity && plan.entity !== c.entity) return fail(`${plan.entity}, expected ${c.entity}`);
  const rec = plan.records[0];
  if (!rec || plan.records.length !== 1) return fail(`${plan.records.length} records`);
  const catalog = await loadCatalog(member.workspace.id);
  const entity = catalog.find((e) => e.key === plan.entity)!;
  if (c.target) {
    const t = rec.id ? await titleOf(member, plan.entity, rec.id) : null;
    if (!same(c.target, t)) return fail(`changed “${t}”, expected “${c.target}”`);
  }
  for (const [k, v] of Object.entries(c.values)) {
    const got = rec.values[k];
    if (got === undefined) {
      // Defaults code fills in when it makes the card (today, completed).
      if (plan.operation === 'insert' && ['sale_date', 'expense_date', 'status'].includes(k))
        continue;
      return fail(`${k} not set`);
    }
    const g =
      typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? String(got).slice(0, 10) : got;
    if (!same(v, g)) return fail(`${k} = ${String(got)}, expected ${String(v)}`);
  }
  if (plan.operation === 'update') {
    const extra = Object.keys(rec.values).filter((k) => !(k in c.values));
    const extraLinks = Object.keys(rec.references).filter((k) => !(k in c.links));
    if (extra.length || extraLinks.length)
      return fail(`also changed ${[...extra, ...extraLinks].join(', ')}`, true);
  }
  for (const [k, want] of Object.entries(c.links)) {
    const ref = rec.references[k];
    const f = entity.fields.find((x) => x.key === k);
    if (!ref || !f?.references) return fail(`${k} not linked`);
    const got = await linkTitle(member, f.references, ref);
    if (!same(want, got)) return fail(`${k} linked to “${got}”, expected “${want}”`);
  }
  if (c.lines.length) {
    if (rec.lines.length !== c.lines.length)
      return fail(`${rec.lines.length} items, expected ${c.lines.length}`);
    for (const [i, want] of c.lines.entries()) {
      const line = rec.lines[i]!;
      const ref = line.references.product;
      const got = ref ? await linkTitle(member, 'product', ref) : null;
      if (!same(want.product, got))
        return fail(`item ${i + 1} is “${got}”, expected “${want.product}”`);
      if (!same(want.quantity, line.values.quantity))
        return fail(`item ${i + 1} quantity ${String(line.values.quantity)}`);
      if (want.unit_price !== undefined) {
        const item = out.card.items[i]?.text ?? '';
        if (!item.includes(want.unit_price.toFixed(2))) return fail(`item ${i + 1} price: ${item}`);
      }
    }
  }
  if (c.total !== undefined && !(out.card.total ?? '').includes(c.total.toFixed(2)))
    return fail(`total ${out.card.total}, expected ${c.total}`);
  return { ...base, passed: true, unintended: false };
}

function subset(want: unknown, got: unknown): boolean {
  if (want && typeof want === 'object' && !Array.isArray(want))
    return Object.entries(want).every(([k, v]) =>
      subset(v, (got as Record<string, unknown> | undefined)?.[k]),
    );
  if (Array.isArray(want))
    return (
      Array.isArray(got) && want.length === got.length && want.every((v, i) => subset(v, got[i]))
    );
  return typeof want === 'string' && typeof got === 'string'
    ? want.toLowerCase() === got.toLowerCase()
    : want === got;
}

export async function runChangeCase(
  member: MemberWorkspace,
  c: ChangeCase,
  options: { provider: LLMProvider | null; ai: boolean },
): Promise<ChatResult> {
  const out = await planStructureChange(member, c.request, {
    provider: options.provider,
    aiMode: options.ai ? 'auto' : 'never',
  });
  const base = {
    id: c.id,
    expect: c.expect,
    got: out.kind,
    origin: out.kind === 'plan' ? out.origin : out.kind,
  };
  const removes = out.kind === 'plan' && out.impact.destructive;
  const additive = c.expect !== 'plan' || c.destructive === false;
  const fail = (failure: string): ChatResult => ({
    ...base,
    passed: false,
    unintended: removes && additive,
    failure,
  });
  if (out.kind !== c.expect) return fail(`${out.kind}, expected ${c.expect}`);
  if (out.kind !== 'plan') return { ...base, passed: true, unintended: false };
  if (c.destructive !== undefined && out.impact.destructive !== c.destructive)
    return fail(
      out.impact.destructive
        ? 'removes data, expected not to'
        : 'expected to be marked as removing data',
    );
  if (out.plan.ops.length !== c.ops.length)
    return fail(`${out.plan.ops.length} ops, expected ${c.ops.length}`);
  for (const [i, want] of c.ops.entries())
    if (!subset(want, out.plan.ops[i]))
      return fail(`op ${i + 1}: got ${JSON.stringify(out.plan.ops[i])}`);
  return { ...base, passed: true, unintended: false };
}

export interface ChatScores {
  cases: number;
  accuracy: number;
  unintendedRate: number;
  rulesRate: number;
}

export function scoreChat(results: ChatResult[]): ChatScores {
  const r = (n: number) => Math.round((n / Math.max(1, results.length)) * 1000) / 1000;
  return {
    cases: results.length,
    accuracy: r(results.filter((x) => x.passed).length),
    unintendedRate: r(results.filter((x) => x.unintended).length),
    rulesRate: r(results.filter((x) => x.origin === 'rules').length),
  };
}
