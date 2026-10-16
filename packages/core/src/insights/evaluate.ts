import type {
  FactFormat,
  InsightCond,
  InsightExpr,
  InsightFact,
  InsightQuery,
  PackInsightRule,
} from '@bizr/packs';

import { isDecimal } from '../ask/decimal';

/**
 * Deciding insights from answers (AI_DESIGN §7, steps 2–3). Pure: a pack rule plus the rows its
 * questions returned go in, insight candidates with typed facts come out. Every number in a fact is
 * a value from the rows or arithmetic on them. The AI plays no part in deciding *whether* something
 * is an insight.
 *
 * Rows are the compiler's shape: `d0, d1…` for breakdowns, `m_<metric>` and `m_<metric>__prev`.
 * A row's key is its first breakdown (the product, the customer…); other questions are matched to it
 * by their own first breakdown.
 */

export type Row = Record<string, unknown>;
export type Level = 'urgent' | 'warn' | 'info';

export type FactValue =
  | { format: 'text'; value: string }
  /** `exact` keeps a money value Postgres returned, so sums stay exact (no float rounding). */
  | { format: Exclude<FactFormat, 'text'>; value: number; exact?: string };

export interface Candidate {
  ruleId: string;
  category: PackInsightRule['category'];
  /** The row's key as stored (a product name, a channel code); null for rules without breakdowns. */
  key: string | null;
  /** Identity across runs: rule + key + the words a rule chose ("up"/"down"). */
  fingerprint: string;
  level: Level;
  /** Money (or units) at stake, for ordering. Never negative. */
  impact: number;
  score: number;
  facts: Record<string, FactValue>;
  /** For record actions: what to search for. */
  search: string | null;
}

export interface EvaluateInput {
  rule: PackInsightRule;
  /** Effective thresholds (pack defaults with the owner's settings applied). */
  thresholds: Record<string, number>;
  results: Record<string, Row[]>;
  /** Display labels for coded values, by breakdown field ("sale.channel" → etsy → Etsy). */
  valueLabels?: Record<string, Record<string, string>>;
}

const LEVEL_WEIGHT: Record<Level, number> = { urgent: 100, warn: 10, info: 1 };

/** Urgency first, then money at stake: 10× the impact adds one step within a level. */
export function severityScore(level: Level, impact: number): number {
  return LEVEL_WEIGHT[level] * (1 + Math.log10(1 + Math.max(0, impact)));
}

export function effectiveThresholds(
  rule: PackInsightRule,
  saved: Record<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, t] of Object.entries(rule.thresholds)) {
    const v = saved?.[name];
    out[name] =
      t.editable && typeof v === 'number' && Number.isFinite(v)
        ? Math.min(t.max, Math.max(t.min, v))
        : t.default;
  }
  return out;
}

// --- Values ------------------------------------------------------------------------------------

export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && isDecimal(v)) return Number(v);
  return null;
}

function toText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') return String(v);
  return null;
}

/** Exact decimal addition (money sums never go through floats). */
function decimalAdd(values: string[]): string {
  const scale = Math.max(0, ...values.map((v) => (v.split('.')[1] ?? '').length));
  let total = 0n;
  for (const v of values) {
    const neg = v.trim().startsWith('-');
    const [i, f = ''] = v.trim().replace(/^-/, '').split('.');
    const n = BigInt(`${i}${f.padEnd(scale, '0')}`);
    total += neg ? -n : n;
  }
  const neg = total < 0n;
  const digits = (neg ? -total : total).toString().padStart(scale + 1, '0');
  const int = digits.slice(0, digits.length - scale);
  const frac = scale ? `.${digits.slice(-scale)}` : '';
  return `${neg ? '-' : ''}${int}${frac}`;
}

// --- The evaluator -----------------------------------------------------------------------------

class RuleContext {
  readonly main: string;
  private readonly byKey = new Map<string, Map<string, Row[]>>();

  constructor(
    readonly input: EvaluateInput,
    readonly queries: Record<string, InsightQuery>,
  ) {
    this.main = input.rule.rows ?? Object.keys(queries)[0]!;
    for (const [name, rows] of Object.entries(input.results)) {
      const m = new Map<string, Row[]>();
      for (const r of rows) {
        const k = toText(r.d0);
        if (k === null) continue;
        const list = m.get(k) ?? [];
        list.push(r);
        m.set(k, list);
      }
      this.byKey.set(name, m);
    }
  }

  hasKey(query: string): boolean {
    return (this.queries[query]?.dimensions.length ?? 0) > 0;
  }

  /**
   * The rows a rule considers, one per key (questions broken down by a date have several): blank
   * keys are skipped (unlinked or unnamed).
   */
  mainRows(): Row[] {
    const rows = this.input.results[this.main] ?? [];
    if (!this.hasKey(this.main)) return rows.slice(0, 1);
    const seen = new Set<string>();
    return rows.filter((r) => {
      const k = toText(r.d0);
      if (k === null || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /** Rows of another question for this key (all of them when it has no breakdown). */
  rowsFor(query: string, key: string | null): Row[] {
    if (!this.hasKey(query)) return this.input.results[query] ?? [];
    if (key === null) return [];
    return this.byKey.get(query)?.get(key) ?? [];
  }

  allRows(query: string): Row[] {
    const rows = this.input.results[query] ?? [];
    return this.hasKey(query) ? rows.filter((r) => toText(r.d0) !== null) : rows;
  }

  labelFor(query: string, dim: number, raw: string): string {
    const d = this.queries[query]?.dimensions[dim];
    const field = d && 'field' in d ? d.field : undefined;
    return (field && this.input.valueLabels?.[field]?.[raw]) ?? raw;
  }
}

function column(part: string): string {
  return /^d\d$/.test(part) ? part : `m_${part}`;
}

interface Scope {
  ctx: RuleContext;
  key: string | null;
  row: Row | undefined;
  facts: Record<string, InsightFact>;
  computed: Map<string, FactValue | null>;
  rows: Row[];
}

function rawRef(scope: Scope, ref: string, row?: Row): unknown {
  if (ref === 'key') return row ? row.d0 : scope.key;
  const [query, part] = ref.split('.') as [string, string];
  if (row) return row[column(part)];
  if (query === scope.ctx.main) return scope.row?.[column(part)];
  return scope.ctx.rowsFor(query, scope.key)[0]?.[column(part)];
}

function sortedByDate(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    const x = toText(a.d1) ?? '';
    const y = toText(b.d1) ?? '';
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

function seriesOf(scope: Scope, ref: string): number[] {
  const [query, part] = ref.split('.') as [string, string];
  return sortedByDate(scope.ctx.rowsFor(query, scope.key))
    .map((r) => toNumber(r[column(part)]))
    .filter((v): v is number => v !== null);
}

function total(scope: Scope, ref: string): number | null {
  const [query, part] = ref.split('.') as [string, string];
  const vals = scope.ctx
    .allRows(query)
    .map((r) => toNumber(r[column(part)]))
    .filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

function fold(xs: (number | null)[], f: (a: number, b: number) => number): number | null {
  if (xs.some((x) => x === null)) return null;
  return (xs as number[]).reduce(f);
}

export function evalExpr(scope: Scope, e: InsightExpr, row?: Row): number | null {
  if (typeof e === 'number') return e;
  if (typeof e === 'string') return toNumber(rawRef(scope, e, row));
  const all = (xs: InsightExpr[]) => xs.map((x) => evalExpr(scope, x, row));
  if ('threshold' in e) return scope.ctx.input.thresholds[e.threshold] ?? null;
  if ('fact' in e) {
    const f = factValue(scope, e.fact);
    return f && f.format !== 'text' ? f.value : null;
  }
  if ('add' in e) return fold(all(e.add), (a, b) => a + b);
  if ('sub' in e) return fold(all(e.sub), (a, b) => a - b);
  if ('mul' in e) return fold(all(e.mul), (a, b) => a * b);
  if ('div' in e) {
    const [a, b] = all(e.div);
    return a === null || a === undefined || !b ? null : a / b;
  }
  if ('min' in e) return fold(all(e.min), (a, b) => Math.min(a, b));
  if ('max' in e) return fold(all(e.max), (a, b) => Math.max(a, b));
  if ('abs' in e) {
    const v = evalExpr(scope, e.abs, row);
    return v === null ? null : Math.abs(v);
  }
  if ('coalesce' in e) {
    for (const x of e.coalesce) {
      const v = evalExpr(scope, x, row);
      if (v !== null) return v;
    }
    return null;
  }
  if ('pct_change' in e) {
    const [now, before] = all(e.pct_change);
    return now === null || now === undefined || !before ? null : now / before - 1;
  }
  if ('share' in e) {
    const v = evalExpr(scope, e.share, row);
    const t = total(scope, e.share);
    return v === null || !t ? null : v / t;
  }
  if ('total' in e) return total(scope, e.total);
  if ('last' in e) return seriesOf(scope, e.last).at(-1) ?? null;
  // prior: the latest value that differs from the last one (unchanged: the same value).
  const s = seriesOf(scope, e.prior);
  const last = s.at(-1);
  if (last === undefined) return null;
  for (let i = s.length - 2; i >= 0; i--) if (s[i] !== last) return s[i]!;
  return last;
}

export function evalCond(scope: Scope, c: InsightCond, row?: Row): boolean {
  if ('all' in c) return c.all.every((x) => evalCond(scope, x, row));
  if ('any' in c) return c.any.some((x) => evalCond(scope, x, row));
  if ('present' in c) return toText(rawRef(scope, c.present, row)) !== null;
  const [op, args] = Object.entries(c)[0] as [string, InsightExpr[]];
  const a = evalExpr(scope, args[0]!, row);
  const b = evalExpr(scope, args[1]!, row);
  if (a === null || b === null) return false;
  switch (op) {
    case 'lt':
      return a < b;
    case 'lte':
      return a <= b;
    case 'gt':
      return a > b;
    case 'gte':
      return a >= b;
    case 'eq':
      return a === b;
    default:
      return a !== b;
  }
}

/** The text a ref names for a row: the key or a breakdown, with its display label. */
function textOf(scope: Scope, ref: string, row?: Row): string | null {
  if (ref === 'key') {
    const raw = toText(row ? row.d0 : scope.key);
    return raw === null ? null : scope.ctx.labelFor(scope.ctx.main, 0, raw);
  }
  const [query, part] = ref.split('.') as [string, string];
  const raw = toText(rawRef(scope, ref, row));
  if (raw === null) return null;
  return /^d\d$/.test(part) ? scope.ctx.labelFor(query, Number(part.slice(1)), raw) : raw;
}

function numberFact(
  format: Exclude<FactFormat, 'text'>,
  value: number | null,
  exact?: string,
): FactValue | null {
  if (value === null) return null;
  return exact !== undefined && format === 'money' ? { format, value, exact } : { format, value };
}

function exactOf(scope: Scope, e: InsightExpr, row?: Row): string | undefined {
  if (typeof e !== 'string' || e === 'key') return undefined;
  const raw = rawRef(scope, e, row);
  return typeof raw === 'string' && isDecimal(raw) ? raw : undefined;
}

function computeFact(scope: Scope, f: InsightFact): FactValue | null {
  if ('value' in f) return numberFact(f.format, evalExpr(scope, f.value), exactOf(scope, f.value));
  if ('text' in f) {
    let row: Row | undefined;
    if (f.by && f.text !== 'key') {
      const [query] = f.text.split('.') as [string];
      let best = -Infinity;
      for (const r of scope.ctx.rowsFor(query, scope.key)) {
        const v = evalExpr(scope, f.by, r);
        if (v !== null && v > best && toText(rawRef(scope, f.text, r)) !== null) {
          best = v;
          row = r;
        }
      }
    }
    const t = f.text === 'key' || !f.by || row ? textOf(scope, f.text, row) : null;
    return t !== null
      ? { format: 'text', value: t }
      : f.fallback
        ? { format: 'text', value: f.fallback }
        : null;
  }
  if ('choose' in f) return { format: 'text', value: evalCond(scope, f.choose) ? f.then : f.else };
  if ('count' in f) return { format: 'integer', value: scope.rows.length };
  if ('sum' in f) {
    const vals = scope.rows.map((r) => evalExpr(scope, f.sum, r));
    if (vals.length === 0 || vals.some((v) => v === null)) return null;
    const exacts = scope.rows.map((r) => exactOf(scope, f.sum, r));
    const exact = exacts.every((x) => x !== undefined) ? decimalAdd(exacts) : undefined;
    return numberFact(
      f.format,
      (vals as number[]).reduce((a, b) => a + b, 0),
      exact,
    );
  }
  // top: the value (or name) on the row with the largest `by`.
  let best: Row | undefined;
  let bestBy = -Infinity;
  for (const r of scope.rows) {
    const v = evalExpr(scope, f.by, r);
    if (v !== null && v > bestBy) {
      bestBy = v;
      best = r;
    }
  }
  if (!best) return null;
  if (f.format === 'text') {
    const t = typeof f.top === 'string' ? textOf(scope, f.top, best) : null;
    return t === null ? null : { format: 'text', value: t };
  }
  return numberFact(f.format, evalExpr(scope, f.top, best), exactOf(scope, f.top, best));
}

function factValue(scope: Scope, name: string): FactValue | null {
  if (scope.computed.has(name)) return scope.computed.get(name)!;
  const f = scope.facts[name];
  scope.computed.set(name, null); // guards against a fact that refers to itself
  const v = f ? computeFact(scope, f) : null;
  scope.computed.set(name, v);
  return v;
}

function finish(scope: Scope, rule: PackInsightRule): Candidate | null {
  const facts: Record<string, FactValue> = {};
  for (const name of Object.keys(rule.facts)) {
    const v = factValue(scope, name);
    // A sentence with a hole in it is worse than no sentence.
    if (v === null) return null;
    facts[name] = v;
  }
  const s = rule.severity;
  const level: Level =
    s.urgent && evalCond(scope, s.urgent)
      ? 'urgent'
      : s.warn && evalCond(scope, s.warn)
        ? 'warn'
        : s.otherwise;
  const impact = Math.max(0, s.impact === undefined ? 0 : (evalExpr(scope, s.impact) ?? 0));
  const chosen = Object.entries(rule.facts)
    .filter(([, f]) => 'choose' in f)
    .map(([name]) => (facts[name] as { value: string }).value);
  const keyPart = scope.key === null ? '' : scope.key.trim().toLowerCase();
  const search =
    rule.action && 'records' in rule.action && rule.action.search
      ? (toText(rawRef(scope, rule.action.search)) ?? null)
      : null;
  return {
    ruleId: rule.id,
    category: rule.category,
    key: scope.key,
    fingerprint: [rule.id, keyPart, ...chosen].join('|'),
    level,
    impact,
    score: severityScore(level, impact),
    facts,
    search,
  };
}

/** Runs one rule over its questions' rows. Each-scope rules: the biggest `limit` candidates. */
export function evaluateRule(input: EvaluateInput): Candidate[] {
  const { rule } = input;
  const ctx = new RuleContext(input, rule.queries);
  const base = { ctx, facts: rule.facts };
  const qualifying = ctx.mainRows().filter((row) => {
    const scope: Scope = { ...base, key: toText(row.d0), row, computed: new Map(), rows: [row] };
    return !rule.where || evalCond(scope, rule.where);
  });
  if (rule.scope === 'summary') {
    if (qualifying.length === 0) return [];
    const scope: Scope = {
      ...base,
      key: null,
      row: qualifying[0],
      computed: new Map(),
      rows: qualifying,
    };
    if (rule.require && !evalCond(scope, rule.require)) return [];
    const c = finish(scope, rule);
    return c ? [c] : [];
  }
  const out: Candidate[] = [];
  for (const row of qualifying) {
    const key = ctx.hasKey(ctx.main) ? toText(row.d0) : null;
    const c = finish({ ...base, key, row, computed: new Map(), rows: [row] }, rule);
    if (c) out.push(c);
  }
  return out.sort((a, b) => b.score - a.score).slice(0, rule.limit);
}
