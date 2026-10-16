import type { Agg, Cond, MetricCond, MetricExpr, PackMetric, RowExpr } from '@bizr/packs';

import type { SemanticModel } from './model';

/**
 * Metric availability (ARCHITECTURE §7). A metric is available when every detail it needs holds
 * data in this workspace. Parts wrapped in `coalesce` are optional: missing ones drop out (net sales
 * without any returns is just sales after discounts). The result is a self-contained expression with
 * references, named expressions and named filters inlined, ready for the compiler.
 */

/** A resolved row condition (named filters expanded). */
export type ResolvedCond = Exclude<Cond, string>;

export type Resolved<T> = { ok: T } | { missing: string[] };

export type Availability =
  { available: true; ir: MetricExpr } | { available: false; missing: string[]; reason: string };

export const AGG_KINDS = ['sum', 'avg', 'min', 'max', 'count_distinct', 'latest', 'count'] as const;
export type AggKind = (typeof AGG_KINDS)[number];

export function aggKind(a: Agg): AggKind {
  return AGG_KINDS.find((k) => k in a)!;
}

/** The row expression an aggregate works on (undefined for `count`). */
export function aggValue(a: Agg): RowExpr | undefined {
  const k = aggKind(a);
  return k === 'count' ? undefined : (a as unknown as Record<string, RowExpr>)[k];
}

/** True if `e` is an aggregate node. */
export function isAgg(e: MetricExpr): e is Agg {
  return AGG_KINDS.some((k) => k in e) && !('per' in e && 'rollup' in e);
}

const isOk = <T>(r: Resolved<T>): r is { ok: T } => 'ok' in r;
const missingOf = (rs: Resolved<unknown>[]) => [
  ...new Set(rs.flatMap((r) => ('missing' in r ? r.missing : []))),
];

export class AvailabilityResolver {
  readonly #memo = new Map<string, Availability>();
  readonly #resolving = new Set<string>();

  constructor(readonly model: SemanticModel) {}

  inCatalog(ref: string): boolean {
    const [e, f] = ref.split('.');
    return Boolean(this.model.entities.find((x) => x.key === e)?.fields.some((x) => x.key === f));
  }

  hasData(ref: string): boolean {
    return this.inCatalog(ref) && (this.model.present ? this.model.present.has(ref) : true);
  }

  metric(id: string): Availability {
    const memo = this.#memo.get(id);
    if (memo) return memo;
    const def = this.model.metrics.get(id);
    if (!def) return { available: false, missing: [], reason: `Unknown measure “${id}”.` };
    if (this.#resolving.has(id)) throw new Error(`Metric ${id} depends on itself`);
    this.#resolving.add(id);
    const r = this.#metricExpr(def.ir);
    this.#resolving.delete(id);
    let out: Availability;
    if (isOk(r)) {
      const any = def.requires_any;
      if (any && !any.some((ref) => this.hasData(ref)))
        out = { available: false, missing: any, reason: reasonFor(def, any, this.model) };
      else out = { available: true, ir: r.ok };
    } else {
      out = { available: false, missing: r.missing, reason: reasonFor(def, r.missing, this.model) };
    }
    this.#memo.set(id, out);
    return out;
  }

  row(e: RowExpr): Resolved<RowExpr> {
    if ('field' in e) return this.hasData(e.field) ? { ok: e } : { missing: [e.field] };
    if ('const' in e) return { ok: e };
    if ('expr' in e) {
      const named = this.model.expressions[e.expr];
      if (!named) return { missing: [`expression ${e.expr}`] };
      return this.row(named);
    }
    if ('allocate' in e) {
      const by = this.row(e.allocate.by);
      const need = [e.allocate.amount, e.allocate.within].filter((r) => !this.hasData(r));
      if (!isOk(by) || need.length > 0) return { missing: [...need, ...missingOf([by])] };
      return { ok: { allocate: { ...e.allocate, by: by.ok } } };
    }
    if ('coalesce' in e) {
      const parts = e.coalesce.map((x) => this.row(x));
      const ok = parts.filter(isOk).map((p) => p.ok);
      if (ok.length === 0) return { missing: missingOf(parts) };
      return { ok: ok.length === 1 ? ok[0]! : { coalesce: ok } };
    }
    const [op, args] = Object.entries(e)[0] as ['add' | 'sub' | 'mul' | 'div', RowExpr[]];
    const parts = args.map((x) => this.row(x));
    if (!parts.every(isOk)) return { missing: missingOf(parts) };
    return { ok: { [op]: parts.map((p) => p.ok) } as RowExpr };
  }

  conds(where: readonly Cond[] | undefined): Resolved<ResolvedCond[]> {
    const out: ResolvedCond[] = [];
    for (const c of where ?? []) {
      if (typeof c === 'string') {
        const named = this.model.filters[c];
        if (!named) return { missing: [`filter ${c}`] };
        const r = this.conds(named);
        if (!isOk(r)) return r;
        out.push(...r.ok);
      } else {
        // A filter on a detail the workspace doesn't have at all can't be applied.
        if (!this.inCatalog(c.field)) return { missing: [c.field] };
        out.push(c);
      }
    }
    return { ok: out };
  }

  agg(a: Agg): Resolved<Agg> {
    const conds = this.conds(a.where);
    const kind = aggKind(a);
    const value: Resolved<RowExpr | undefined> =
      kind === 'count' ? { ok: undefined } : this.row(aggValue(a)!);
    const extra: string[] = [];
    if ('latest' in a) {
      if (!this.hasData(a.per)) extra.push(a.per);
      if (!this.hasData(a.by)) extra.push(a.by);
    }
    if (a.time && !this.hasData(a.time)) extra.push(a.time);
    if (a.from && !this.model.entities.some((e) => e.key === a.from)) extra.push(`${a.from}.*`);
    if (!isOk(conds) || !isOk(value) || extra.length > 0)
      return { missing: [...extra, ...missingOf([conds, value])] };
    const { where: _where, ...rest } = a;
    void _where;
    const resolved = (kind === 'count' ? rest : { ...rest, [kind]: value.ok }) as Agg;
    return { ok: conds.ok.length ? { ...resolved, where: conds.ok } : resolved };
  }

  #metricExpr(e: MetricExpr): Resolved<MetricExpr> {
    if ('ref' in e) {
      const a = this.metric(e.ref);
      return a.available ? { ok: a.ir } : { missing: a.missing };
    }
    if ('const' in e || 'period' in e) return { ok: e };
    if ('per' in e && 'rollup' in e) {
      if (!this.model.entities.some((x) => x.key === e.per)) return { missing: [`${e.per}.*`] };
      const measure = e.measure ? this.#metricExpr(e.measure) : undefined;
      const conds: MetricCond[] = [];
      const missing: string[] = [];
      if (measure && !isOk(measure)) missing.push(...measure.missing);
      for (const c of e.where ?? []) {
        const of = this.#metricExpr(c.of);
        if (!isOk(of)) {
          missing.push(...of.missing);
          continue;
        }
        if (typeof c.value === 'object') {
          const value = this.#metricExpr(c.value);
          if (!isOk(value)) missing.push(...value.missing);
          else conds.push({ of: of.ok, op: c.op, value: value.ok });
        } else {
          conds.push({ of: of.ok, op: c.op, ...(c.value !== undefined ? { value: c.value } : {}) });
        }
      }
      if (missing.length > 0) return { missing: [...new Set(missing)] };
      return {
        ok: {
          per: e.per,
          rollup: e.rollup,
          ...(measure && isOk(measure) ? { measure: measure.ok } : {}),
          ...(conds.length ? { where: conds } : {}),
        },
      };
    }
    for (const k of ['add', 'sub', 'mul', 'div', 'days_between'] as const) {
      if (k in e) {
        const parts = (e as Record<string, MetricExpr[]>)[k]!.map((x) => this.#metricExpr(x));
        if (!parts.every(isOk)) return { missing: missingOf(parts) };
        return { ok: { [k]: parts.map((p) => p.ok) } as MetricExpr };
      }
    }
    if ('coalesce' in e) {
      const parts = e.coalesce.map((x) => this.#metricExpr(x));
      const ok = parts.filter(isOk).map((p) => p.ok);
      if (ok.length === 0) return { missing: missingOf(parts) };
      return { ok: ok.length === 1 ? ok[0]! : { coalesce: ok } };
    }
    return this.agg(e as Agg);
  }
}

/** Plain-language reason for an unavailable metric (the pack's hint, else built from labels). */
export function reasonFor(
  def: PackMetric,
  missing: readonly string[],
  model: SemanticModel,
): string {
  if (def.unavailable_hint) return def.unavailable_hint;
  const labels = missing
    .filter((m) => m.includes('.') && !m.endsWith('.*'))
    .map((m) => {
      const [e, f] = m.split('.');
      const ent = model.entities.find((x) => x.key === e);
      const field = ent?.fields.find((x) => x.key === f);
      return field && ent
        ? `the ${field.label.toLowerCase()} of your ${ent.label.plural.toLowerCase()}`
        : undefined;
    })
    .filter((x): x is string => Boolean(x));
  return labels.length
    ? `Add ${labels.join(' and ')} to see ${def.label.toLowerCase()}.`
    : `Upload the files this needs to see ${def.label.toLowerCase()}.`;
}
