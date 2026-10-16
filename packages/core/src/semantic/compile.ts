import type { Agg, MetricCond, MetricExpr, MetricFormat, RowExpr } from '@bizr/packs';

import { columnsFor } from '../change-plan/names';
import type { FieldDef } from '../change-plan/schema';
import { ident } from '../sql/ident';
import { aggKind, aggValue, AvailabilityResolver, isAgg, type ResolvedCond } from './availability';
import { SemanticError, type Hop } from './graph';
import type { CompileContext, SemanticModel } from './model';
import {
  querySpecSchema,
  type Dimension,
  type Filter,
  type QuerySpecInput,
  type TimeGrain,
} from './query-spec';

/**
 * Query-spec compiler (ADR-007, ARCHITECTURE §7). Deterministic: the same model, spec and context
 * always give the same SQL. Every value is a bound parameter; every identifier goes through
 * `ident()`.
 *
 * Shape of the SQL:
 * - one CTE per aggregate, over its base record type, joined only "up" many-to-one links (so rows
 *   never multiply), grouped by the requested breakdown;
 * - per-record roll-ups (per customer, per product) as CTEs over those;
 * - a CTE per period that joins the aggregates on the breakdown and computes the metrics;
 * - with a comparison, the two periods side by side.
 */

export interface ResultColumn {
  key: string;
  kind: 'dimension' | 'metric' | 'previous';
  label: string;
  format?: MetricFormat;
  metric?: string;
  dimension?: Dimension;
}

export interface CompiledQuery {
  sql: string;
  params: unknown[];
  columns: ResultColumn[];
  /** Plain-language assumptions of the metrics used. */
  assumptions: string[];
  period: { from: string; to: string };
  previousPeriod?: { from: string; to: string };
}

const EPOCH = '1900-01-01';

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const out = new Date(Date.UTC(y + years, m - 1, d));
  // 29 Feb → 28 Feb in non-leap years.
  if (out.getUTCMonth() !== m - 1) out.setUTCDate(0);
  return out.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function addMonths(iso: string, months: number): string {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 10);
}

/** The period just before: whole calendar months compare with the months before, else same length. */
function previousPeriod(p: { from: string; to: string }): { from: string; to: string } {
  if (p.from.endsWith('-01') && p.to.endsWith('-01')) {
    const [fy, fm] = p.from.split('-').map(Number) as [number, number];
    const [ty, tm] = p.to.split('-').map(Number) as [number, number];
    const months = (ty - fy) * 12 + (tm - fm);
    return { from: addMonths(p.from, -months), to: p.from };
  }
  return { from: addDays(p.from, -daysBetween(p.from, p.to)), to: p.from };
}

class Params {
  readonly values: unknown[] = [];
  readonly #named = new Map<string, string>();
  add(value: unknown, cast: string): string {
    this.values.push(value);
    return `$${this.values.length}::${cast}`;
  }
  /** One shared parameter per key, allocated on first use (unused parameters make Postgres fail). */
  once(key: string, value: unknown, cast: string): string {
    let p = this.#named.get(key);
    if (!p) {
      p = this.add(value, cast);
      this.#named.set(key, p);
    }
    return p;
  }
}

interface Bounds {
  id: string;
  /** SQL for the first day of the period and the first day after it (both `date`). */
  start: string;
  end: string;
}

interface Grouping {
  dims: readonly Dimension[];
  per?: string;
}

interface FieldInfo {
  entity: string;
  def: FieldDef;
}

type ValueType = 'number' | 'date' | 'text' | 'boolean';

const NUMERIC = new Set(['integer', 'decimal', 'money', 'percent']);

class Compiler {
  readonly params = new Params();
  readonly ctes: string[] = [];
  readonly #cteByKey = new Map<string, string>();
  readonly resolver: AvailabilityResolver;

  constructor(
    readonly model: SemanticModel,
    readonly ctx: CompileContext,
    readonly filters: readonly Filter[],
  ) {
    this.resolver = new AvailabilityResolver(model);
  }

  get tz(): string {
    return this.params.once('tz', this.ctx.timezone, 'text');
  }

  // --- catalog helpers --------------------------------------------------------------------------

  field(ref: string): FieldInfo {
    const [entity, key] = ref.split('.') as [string, string];
    const def = this.model.graph.entity(entity)?.fields.find((f) => f.key === key);
    if (!def)
      throw new SemanticError(
        `Unknown field ${ref}`,
        `We don’t have that detail in your data yet.`,
      );
    return { entity, def };
  }

  label(ref: string): string {
    const dim = this.model.dimensions.find((d) => d.field === ref);
    if (dim) return dim.label;
    const { entity, def } = this.field(ref);
    return `${this.model.graph.entity(entity)!.label.singular} ${def.label.toLowerCase()}`;
  }

  #entityLabel(key: string): string {
    return this.model.graph.entity(key)?.label.plural.toLowerCase() ?? key;
  }

  // --- aggregates -------------------------------------------------------------------------------

  /** The record type an aggregate is computed over. */
  baseOf(a: Agg): string {
    if (a.from) return a.from;
    if ('latest' in a) return a.per.split('.')[0]!;
    const entities = new Set<string>();
    const visitRow = (e: RowExpr) => {
      if ('field' in e) entities.add(e.field.split('.')[0]!);
      else if ('allocate' in e) {
        entities.add(e.allocate.within.split('.')[0]!);
        visitRow(e.allocate.by);
      } else if ('expr' in e) {
        const named = this.model.expressions[e.expr];
        if (named) visitRow(named);
      } else if (!('const' in e)) {
        for (const args of Object.values<RowExpr[]>(e as Record<string, RowExpr[]>))
          args.forEach(visitRow);
      }
    };
    const value = aggValue(a);
    if (value) visitRow(value);
    for (const c of (a.where ?? []) as ResolvedCond[]) entities.add(c.field.split('.')[0]!);
    const candidates = [...entities];
    const base = candidates.filter((c) =>
      candidates.every((other) => this.model.graph.path(c, other) !== null),
    );
    if (base.length !== 1)
      throw new Error(
        `Can't tell which record type to total for ${JSON.stringify(a)} (candidates: ${candidates.join(', ')})`,
      );
    return base[0]!;
  }

  /** CTE for one aggregate at one grouping and period. Identical requests share a CTE. */
  aggCte(a: Agg, grouping: Grouping, bounds: Bounds): string {
    const key = JSON.stringify([a, grouping, bounds.id]);
    const existing = this.#cteByKey.get(key);
    if (existing) return existing;

    const base = this.baseOf(a);
    const baseEntity = this.model.graph.entity(base);
    if (!baseEntity) throw new Error(`No record type ${base}`);
    const joins = new JoinTree(this, base);
    const kind = aggKind(a);
    const where: string[] = [];

    // Time window (from the aggregate's own date).
    const timeRef = a.time ?? ('latest' in a ? a.by : this.#defaultTime(base));
    const window = a.window ?? 'period';
    let timeCol: { sql: string; type: 'date' | 'datetime' } | undefined;
    if (timeRef) {
      const info = this.field(timeRef);
      timeCol = {
        sql: joins.column(timeRef),
        type: info.def.type === 'datetime' ? 'datetime' : 'date',
      };
    }

    // The base table, with any window functions it needs computed before filtering.
    const extras: string[] = [];
    const allocations = new Map<string, string>();
    const latestWhere: string[] = [];
    const collectAllocations = (e: RowExpr) => {
      if ('allocate' in e) {
        const within = this.field(e.allocate.within);
        if (within.entity !== base)
          throw new Error(`allocate.within must be a link on ${base}, got ${e.allocate.within}`);
        const name = `__w${allocations.size}`;
        const by = this.rowSql(e.allocate.by, new JoinTree(this, base, 't', true));
        extras.push(
          `SUM(${by}) OVER (PARTITION BY t.${ident(columnsFor(within.def).fk!)}) AS ${ident(name)}`,
        );
        allocations.set(JSON.stringify(e), name);
        collectAllocations(e.allocate.by);
      } else if ('expr' in e) {
        const named = this.model.expressions[e.expr];
        if (named) collectAllocations(named);
      } else if (!('field' in e) && !('const' in e)) {
        for (const args of Object.values<RowExpr[]>(e as Record<string, RowExpr[]>))
          args.forEach(collectAllocations);
      }
    };
    const value = aggValue(a);
    if (value) collectAllocations(value);
    if (kind === 'latest' && 'latest' in a) {
      const per = this.field(a.per);
      const by = this.field(a.by);
      if (per.entity !== base || by.entity !== base)
        throw new Error(`latest.per and latest.by must be on ${base}`);
      const byCol = `t.${ident(by.def.key)}`;
      const tType = by.def.type === 'datetime' ? 'datetime' : 'date';
      latestWhere.push(...this.#windowConds(byCol, tType, window, bounds));
      extras.push(
        `ROW_NUMBER() OVER (PARTITION BY t.${ident(columnsFor(per.def).fk!)} ORDER BY ${byCol} DESC, t."_id" DESC) AS "__rn"`,
      );
      where.push(`b."__rn" = 1`);
    }
    const table = ident(baseEntity.tableName);
    const source =
      extras.length > 0
        ? `(SELECT t.*, ${extras.join(', ')} FROM ${table} t WHERE ${['t."_deleted_at" IS NULL', ...latestWhere].join(' AND ')}) b`
        : `${table} b`;
    if (extras.length === 0) where.push(`b."_deleted_at" IS NULL`);

    if (timeCol && kind !== 'latest')
      where.push(...this.#windowConds(timeCol.sql, timeCol.type, window, bounds));

    // Value.
    let valueSql: string;
    if (kind === 'count') valueSql = 'COUNT(*)';
    else {
      const v = aggValue(a)!;
      const rowSql = this.rowSql(v, joins, allocations);
      const vType = this.rowType(v);
      const dateField = 'field' in v && vType === 'date' ? this.field(v.field) : undefined;
      const asDate =
        dateField?.def.type === 'datetime' ? `(${rowSql} AT TIME ZONE ${this.tz})::date` : rowSql;
      switch (kind) {
        case 'sum':
        case 'latest':
          valueSql = `SUM(${rowSql})`;
          break;
        case 'avg':
          valueSql = `AVG(${rowSql})`;
          break;
        case 'min':
          valueSql = `MIN(${asDate})`;
          break;
        case 'max':
          valueSql = `MAX(${asDate})`;
          break;
        case 'count_distinct':
          valueSql = `COUNT(DISTINCT ${rowSql})`;
          break;
      }
    }

    // Conditions: the aggregate's own, then the query's filters.
    for (const c of (a.where ?? []) as ResolvedCond[]) where.push(this.condSql(c, joins, bounds));
    for (const f of this.filters) {
      const target = f.field.split('.')[0]!;
      if (this.model.graph.path(base, target) === null)
        throw new SemanticError(
          `Filter ${f.field} unreachable from ${base}`,
          `We can’t narrow ${this.#entityLabel(base)} down by ${this.label(f.field).toLowerCase()}.`,
        );
      where.push(this.filterSql(f, joins));
    }

    // Grouping.
    const select: string[] = [];
    const groupBy: string[] = [];
    grouping.dims.forEach((d, i) => {
      const sql = this.dimSql(d, base, joins, timeCol);
      select.push(`${sql} AS "d${i}"`);
      groupBy.push(sql);
    });
    if (grouping.per) {
      const path = this.model.graph.path(base, grouping.per);
      if (path === null)
        throw new SemanticError(
          `per ${grouping.per} unreachable from ${base}`,
          `We can’t work that out per ${this.model.graph.entity(grouping.per)?.label.singular.toLowerCase() ?? grouping.per}.`,
        );
      const pk = `${joins.alias(path)}."_id"`;
      select.push(`${pk} AS "pk"`);
      groupBy.push(pk);
      where.push(`${pk} IS NOT NULL`);
    }
    select.push(`${valueSql} AS "v"`);

    const name = `a${this.ctes.length}`;
    this.ctes.push(
      `${ident(name)} AS (SELECT ${select.join(', ')} FROM ${source}${joins.sql()} WHERE ${where.join(' AND ')}${groupBy.length ? ` GROUP BY ${groupBy.join(', ')}` : ''})`,
    );
    this.#cteByKey.set(key, name);
    return name;
  }

  #defaultTime(base: string): string | undefined {
    const t = this.model.graph.timeField(base);
    return t ? `${t.entity}.${t.field}` : undefined;
  }

  #bound(which: 'start' | 'end', type: 'date' | 'datetime', bounds: Bounds, shiftDays = 0): string {
    const d = which === 'start' ? bounds.start : bounds.end;
    const shift = Math.trunc(shiftDays);
    const day = shift ? `(${d} ${shift < 0 ? '-' : '+'} ${Math.abs(shift)})` : d;
    return type === 'date' ? day : `(${day}::timestamp AT TIME ZONE ${this.tz})`;
  }

  #windowConds(
    col: string,
    type: 'date' | 'datetime',
    window: NonNullable<Agg['window']>,
    bounds: Bounds,
  ): string[] {
    if (window === 'all') return [];
    if (window === 'to_end') return [`${col} < ${this.#bound('end', type, bounds)}`];
    if (window === 'period')
      return [
        `${col} >= ${this.#bound('start', type, bounds)}`,
        `${col} < ${this.#bound('end', type, bounds)}`,
      ];
    return [
      `${col} >= ${this.#bound('end', type, bounds, -window.last_days)}`,
      `${col} < ${this.#bound('end', type, bounds)}`,
    ];
  }

  // --- row level --------------------------------------------------------------------------------

  rowType(e: RowExpr): ValueType {
    if ('field' in e) {
      const t = this.field(e.field).def.type;
      if (NUMERIC.has(t)) return 'number';
      if (t === 'date' || t === 'datetime') return 'date';
      if (t === 'boolean') return 'boolean';
      return 'text';
    }
    if ('expr' in e) {
      const named = this.model.expressions[e.expr];
      return named ? this.rowType(named) : 'number';
    }
    if ('coalesce' in e) return this.rowType(e.coalesce[0]!);
    return 'number';
  }

  rowSql(
    e: RowExpr,
    joins: JoinTree,
    allocations: ReadonlyMap<string, string> = new Map(),
  ): string {
    if ('field' in e) return joins.column(e.field);
    if ('const' in e) return this.params.add(e.const, 'numeric');
    if ('expr' in e) {
      const named = this.model.expressions[e.expr];
      if (!named) throw new Error(`Unknown expression ${e.expr}`);
      return this.rowSql(named, joins, allocations);
    }
    if ('allocate' in e) {
      const w = allocations.get(JSON.stringify(e));
      if (!w) throw new Error('allocation outside an aggregate');
      const amount = joins.column(e.allocate.amount);
      const by = this.rowSql(e.allocate.by, joins, allocations);
      return `(${amount} * ${by} / NULLIF(b.${ident(w)}, 0))`;
    }
    if ('coalesce' in e)
      return `COALESCE(${e.coalesce.map((x) => this.rowSql(x, joins, allocations)).join(', ')})`;
    return arith(e as Record<'add' | 'sub' | 'mul' | 'div', RowExpr[]>, (x) =>
      this.rowSql(x, joins, allocations),
    );
  }

  #valueParam(type: string, value: unknown): string {
    if (NUMERIC.has(type)) return this.params.add(value, 'numeric');
    if (type === 'boolean') return this.params.add(value, 'boolean');
    if (type === 'date') return this.params.add(value, 'date');
    if (type === 'datetime')
      return `(${this.params.add(value, 'timestamp')} AT TIME ZONE ${this.tz})`;
    return this.params.add(String(value).toLowerCase(), 'text');
  }

  #listParam(type: string, values: unknown[]): string {
    if (NUMERIC.has(type)) return this.params.add(values, 'numeric[]');
    if (type === 'boolean') return this.params.add(values, 'boolean[]');
    if (type === 'date') return this.params.add(values, 'date[]');
    return this.params.add(
      values.map((v) => String(v).toLowerCase()),
      'text[]',
    );
  }

  condSql(c: ResolvedCond, joins: JoinTree, bounds: Bounds): string {
    const { def } = this.field(c.field);
    const raw = joins.column(c.field);
    const isText = def.type === 'text';
    const col = isText ? `lower(${raw})` : raw;
    const v = c.value;
    if (c.op === 'is_null') return `${raw} IS NULL`;
    if (c.op === 'not_null') return `${raw} IS NOT NULL`;
    if (v !== undefined && typeof v === 'object' && !Array.isArray(v)) {
      const type = def.type === 'datetime' ? 'datetime' : 'date';
      return `${raw} ${OPS[c.op as keyof typeof OPS]} ${this.#bound(v.period, type, bounds, v.offset_days ?? 0)}`;
    }
    if (c.op === 'in' || c.op === 'not_in') {
      const list = this.#listParam(def.type, Array.isArray(v) ? v : [v]);
      return c.op === 'in'
        ? `${col} = ANY(${list})`
        : `(${raw} IS NULL OR NOT (${col} = ANY(${list})))`;
    }
    const param = this.#valueParam(def.type, Array.isArray(v) ? v[0] : v);
    if (c.op === 'neq') return `(${raw} IS NULL OR ${col} <> ${param})`;
    return `${col} ${OPS[c.op as keyof typeof OPS]} ${param}`;
  }

  filterSql(f: Filter, joins: JoinTree): string {
    const { def } = this.field(f.field);
    if (def.type === 'reference')
      throw new SemanticError(`Filter on link ${f.field}`, 'We can’t filter on that.');
    const raw = joins.column(f.field);
    const isText = def.type === 'text';
    const col = isText ? `lower(${raw})` : raw;
    if (f.op === 'contains') {
      const text = String(Array.isArray(f.value) ? f.value[0] : f.value)
        .toLowerCase()
        .replace(/[\\%_]/g, (m) => `\\${m}`);
      return `${col} LIKE ${this.params.add(`%${text}%`, 'text')} ESCAPE '\\'`;
    }
    if (f.op === 'in' || f.op === 'not_in') {
      const list = this.#listParam(def.type, Array.isArray(f.value) ? f.value : [f.value]);
      return f.op === 'in'
        ? `${col} = ANY(${list})`
        : `(${raw} IS NULL OR NOT (${col} = ANY(${list})))`;
    }
    const param = this.#valueParam(def.type, Array.isArray(f.value) ? f.value[0] : f.value);
    if (f.op === 'neq') return `(${raw} IS NULL OR ${col} <> ${param})`;
    return `${col} ${OPS[f.op]} ${param}`;
  }

  dimSql(
    d: Dimension,
    base: string,
    joins: JoinTree,
    timeCol: { sql: string; type: 'date' | 'datetime' } | undefined,
  ): string {
    if ('field' in d) {
      const { entity, def } = this.field(d.field);
      if (def.type === 'reference')
        throw new SemanticError(`Dimension on link ${d.field}`, 'We can’t break that down.');
      if (this.model.graph.path(base, entity) === null)
        throw new SemanticError(
          `Dimension ${d.field} unreachable from ${base}`,
          `We can’t split ${this.#entityLabel(base)} by ${this.label(d.field).toLowerCase()}.`,
        );
      return joins.column(d.field);
    }
    if (!timeCol)
      throw new SemanticError(
        `No time field for ${base}`,
        `${this.model.graph.entity(base)?.label.plural ?? base} don’t have dates, so we can’t show them over time.`,
      );
    return this.#bucket(d.time, timeCol);
  }

  #bucket(grain: TimeGrain, col: { sql: string; type: 'date' | 'datetime' }): string {
    const local =
      col.type === 'datetime' ? `(${col.sql} AT TIME ZONE ${this.tz})` : `(${col.sql})::timestamp`;
    switch (grain) {
      case 'day':
        return `${local}::date`;
      case 'month':
        return `date_trunc('month', ${local})::date`;
      case 'week': {
        const shift = (8 - Math.trunc(this.ctx.weekStart)) % 7;
        return shift === 0
          ? `date_trunc('week', ${local})::date`
          : `(date_trunc('week', ${local} + interval '${shift} days') - interval '${shift} days')::date`;
      }
      case 'quarter':
      case 'year': {
        const months = (Math.trunc(this.ctx.fiscalYearStartMonth) - 1 + 12) % 12;
        return months === 0
          ? `date_trunc('${grain}', ${local})::date`
          : `(date_trunc('${grain}', ${local} - interval '${months} months') + interval '${months} months')::date`;
      }
    }
  }

  // --- metric level -----------------------------------------------------------------------------

  metricSql(e: MetricExpr, scope: Scope): string {
    if (isAgg(e)) {
      const v = `${scope.use(this.aggCte(e, scope.grouping, scope.bounds))}."v"`;
      // Totals and counts of nothing are zero (a channel with refunds but no sales nets negative).
      return ['sum', 'count', 'count_distinct', 'latest'].includes(aggKind(e))
        ? `COALESCE(${v}, 0)`
        : v;
    }
    if ('const' in e) return this.params.add(e.const, 'numeric');
    if ('period' in e) return this.#bound(e.period, 'date', scope.bounds, e.offset_days ?? 0);
    if ('ref' in e) {
      const a = this.resolver.metric(e.ref);
      if (!a.available) throw new SemanticError(`Metric ${e.ref} unavailable`, a.reason);
      return this.metricSql(a.ir, scope);
    }
    if ('per' in e && 'rollup' in e) {
      if (scope.grouping.per) throw new Error('A per-record roll-up can’t contain another roll-up');
      return `${scope.use(this.rollupCte(e, scope))}."v"`;
    }
    if ('days_between' in e) {
      const [a, b] = e.days_between.map((x) => this.metricSql(x, scope)) as [string, string];
      return `((${b})::date - (${a})::date)`;
    }
    if ('coalesce' in e)
      return `COALESCE(${e.coalesce.map((x) => this.metricSql(x, scope)).join(', ')})`;
    return arith(
      e as Record<'add' | 'sub' | 'mul' | 'div', MetricExpr[]>,
      (x) => `(${this.metricSql(x, scope)})::numeric`,
    );
  }

  rollupCte(e: Extract<MetricExpr, { per: string; rollup: string }>, outer: Scope): string {
    const key = JSON.stringify([e, outer.grouping, outer.bounds.id]);
    const existing = this.#cteByKey.get(key);
    if (existing) return existing;
    const inner = new Scope(this, { dims: outer.grouping.dims, per: e.per }, outer.bounds);
    const measure = e.measure ? this.metricSql(e.measure, inner) : undefined;
    const conds = (e.where ?? []).map((c) => this.#metricCond(c, inner));
    if (inner.empty) throw new Error(`Roll-up per ${e.per} has nothing to compute over`);
    const filter = conds.length ? ` FILTER (WHERE ${conds.join(' AND ')})` : '';
    const agg =
      e.rollup === 'count'
        ? `COUNT(*)${filter}`
        : `${e.rollup === 'sum' ? 'SUM' : 'AVG'}(${measure!})${filter}`;
    const dims = outer.grouping.dims.map((_, i) => `k."d${i}"`);
    const name = `r${this.ctes.length}`;
    this.ctes.push(
      `${ident(name)} AS (SELECT ${[...dims.map((d, i) => `${d} AS "d${i}"`), `${agg} AS "v"`].join(', ')}${inner.fromSql()}${dims.length ? ` GROUP BY ${dims.join(', ')}` : ''})`,
    );
    this.#cteByKey.set(key, name);
    return name;
  }

  #metricCond(c: MetricCond, scope: Scope): string {
    const of = this.metricSql(c.of, scope);
    if (c.op === 'is_null') return `(${of}) IS NULL`;
    if (c.op === 'not_null') return `(${of}) IS NOT NULL`;
    const value =
      typeof c.value === 'object'
        ? this.metricSql(c.value, scope)
        : this.params.add(c.value ?? 0, 'numeric');
    return `(${of}) ${OPS[c.op]} (${value})`;
  }
}

const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' } as const;

function arith<T>(
  e: Partial<Record<'add' | 'sub' | 'mul' | 'div', T[]>>,
  sql: (x: T) => string,
): string {
  if (e.div) {
    const [a, b] = e.div.map(sql) as [string, string];
    return `(${a} / NULLIF(${b}, 0))`;
  }
  const op = e.add ? '+' : e.sub ? '-' : '*';
  const args = (e.add ?? e.sub ?? e.mul ?? []).map(sql);
  return `(${args.join(` ${op} `)})`;
}

/** Joins from one base record type, one alias per distinct path. */
class JoinTree {
  readonly #aliases = new Map<string, string>();
  readonly #joins: string[] = [];

  constructor(
    private readonly c: Compiler,
    private readonly base: string,
    private readonly baseAlias = 'b',
    /** Base columns only (inside window functions). */
    private readonly baseOnly = false,
  ) {}

  alias(path: readonly Hop[]): string {
    if (path.length === 0) return this.baseAlias;
    if (this.baseOnly) throw new Error('Only fields of the base record type are allowed here');
    const key = path.map((h) => `${h.entity}.${h.field}`).join('>');
    const existing = this.#aliases.get(key);
    if (existing) return existing;
    const parent = this.alias(path.slice(0, -1));
    const hop = path[path.length - 1]!;
    const fk = columnsFor({ key: hop.field, type: 'reference' }).fk!;
    const alias = `j${this.#aliases.size + 1}`;
    const table = ident(this.c.model.graph.entity(hop.target)!.tableName);
    this.#joins.push(
      ` LEFT JOIN ${table} ${alias} ON ${alias}."_id" = ${parent}.${ident(fk)} AND ${alias}."_deleted_at" IS NULL`,
    );
    this.#aliases.set(key, alias);
    return alias;
  }

  column(ref: string): string {
    const { entity, def } = this.c.field(ref);
    const path = this.c.model.graph.path(this.base, entity);
    if (path === null)
      throw new SemanticError(
        `${ref} unreachable from ${this.base}`,
        `We can’t connect ${this.c.model.graph.entity(this.base)?.label.plural.toLowerCase() ?? this.base} to ${this.c.model.graph.entity(entity)?.label.plural.toLowerCase() ?? entity}.`,
      );
    const cols = columnsFor(def);
    return `${this.alias(path)}.${ident(cols.value ?? cols.fk!)}`;
  }

  sql(): string {
    return this.#joins.join('');
  }
}

/** A set of aggregate CTEs joined on a grouping (the breakdown, plus the per-record key). */
class Scope {
  readonly #used: string[] = [];

  constructor(
    private readonly c: Compiler,
    readonly grouping: Grouping,
    readonly bounds: Bounds,
  ) {}

  get empty(): boolean {
    return this.#used.length === 0;
  }

  get keys(): string[] {
    return [...this.grouping.dims.map((_, i) => `d${i}`), ...(this.grouping.per ? ['pk'] : [])];
  }

  use(cte: string): string {
    let i = this.#used.indexOf(cte);
    if (i === -1) {
      this.#used.push(cte);
      i = this.#used.length - 1;
    }
    return `s${i}`;
  }

  /** ` FROM <keys> LEFT JOIN <each aggregate>` (keys = every grouping value any aggregate has). */
  fromSql(): string {
    const keys = this.keys;
    if (keys.length === 0) {
      return ` FROM (SELECT 1) k${this.#used.map((cte, i) => ` LEFT JOIN ${ident(cte)} s${i} ON true`).join('')}`;
    }
    const union = this.#used
      .map((cte) => `SELECT ${keys.map((k) => ident(k)).join(', ')} FROM ${ident(cte)}`)
      .join(' UNION ');
    const on = (i: number) =>
      keys.map((k) => `s${i}.${ident(k)} IS NOT DISTINCT FROM k.${ident(k)}`).join(' AND ');
    return ` FROM (${union}) k${this.#used.map((cte, i) => ` LEFT JOIN ${ident(cte)} s${i} ON ${on(i)}`).join('')}`;
  }
}

export function compileQuery(
  model: SemanticModel,
  input: QuerySpecInput,
  ctx: CompileContext,
): CompiledQuery {
  const spec = querySpecSchema.parse(input);
  const c = new Compiler(model, ctx, spec.filters);

  const period = spec.period ?? { from: EPOCH, to: addDays(ctx.today, 1) };
  if (spec.compare && !spec.period)
    throw new SemanticError('compare needs a period', 'Pick a date range to compare with.');
  const previous = spec.compare
    ? spec.compare === 'previous_year'
      ? { from: addYears(period.from, -1), to: addYears(period.to, -1) }
      : previousPeriod(period)
    : undefined;

  const metrics = spec.metrics.map((id) => {
    const def = model.metrics.get(id);
    if (!def)
      throw new SemanticError(`Unknown metric ${id}`, `We don’t have a measure called “${id}”.`);
    const a = c.resolver.metric(id);
    if (!a.available) throw new SemanticError(`Metric ${id} unavailable`, a.reason);
    return { id, def, ir: a.ir };
  });

  const variant = (name: string, p: { from: string; to: string }) => {
    const bounds: Bounds = {
      id: name,
      get start() {
        return c.params.once(`${name}.start`, p.from, 'date');
      },
      get end() {
        return c.params.once(`${name}.end`, p.to, 'date');
      },
    };
    const scope = new Scope(c, { dims: spec.dimensions }, bounds);
    const cols = metrics.map((m) => `${c.metricSql(m.ir, scope)} AS ${ident(`m_${m.id}`)}`);
    const dims = spec.dimensions.map((_, i) => `k."d${i}"`);
    c.ctes.push(
      `${ident(name)} AS (SELECT ${[...dims.map((d, i) => `${d} AS "d${i}"`), ...cols].join(', ')}${scope.fromSql()})`,
    );
  };
  variant('cur', period);
  if (previous) variant('prev', previous);

  const dimKeys = spec.dimensions.map((_, i) => `d${i}`);
  let select: string;
  if (previous) {
    const dims = dimKeys.map((k) => `COALESCE(c.${ident(k)}, p.${ident(k)}) AS ${ident(k)}`);
    const ms = metrics.flatMap((m) => [
      `c.${ident(`m_${m.id}`)}`,
      `p.${ident(`m_${m.id}`)} AS ${ident(`m_${m.id}__prev`)}`,
    ]);
    const join = dimKeys.length
      ? `FULL JOIN "prev" p ON ${dimKeys.map((k) => `c.${ident(k)} IS NOT DISTINCT FROM p.${ident(k)}`).join(' AND ')}`
      : 'CROSS JOIN "prev" p';
    select = `SELECT ${[...dims, ...ms].join(', ')} FROM "cur" c ${join}`;
  } else {
    select = `SELECT * FROM "cur"`;
  }

  // Row filters on metric values, and the total row count before any limit ("top 15 of 212").
  const having = spec.having.map((h) => {
    if (!metrics.some((m) => m.id === h.metric))
      throw new SemanticError(`having on ${h.metric} not in metrics`, 'We can’t filter by that.');
    const op = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[h.op];
    return `r.${ident(`m_${h.metric}`)} ${op} ${c.params.add(h.value, 'numeric')}`;
  });
  if (having.length || dimKeys.length)
    select = `SELECT r.*${dimKeys.length ? ', count(*) OVER () AS "__total"' : ''} FROM (${select}) r${having.length ? ` WHERE ${having.join(' AND ')}` : ''}`;

  // Order: chosen sort, else over time ascending, else the first metric, largest first.
  const timeIndex = spec.dimensions.findIndex((d) => 'time' in d);
  let order: string | undefined;
  if (spec.sort) {
    const isDim = /^d\d$/.test(spec.sort.by) && Number(spec.sort.by.slice(1)) < dimKeys.length;
    if (!isDim && !metrics.some((m) => m.id === spec.sort!.by))
      throw new SemanticError(`Unknown sort ${spec.sort.by}`, 'We can’t sort by that.');
    order = `${ident(isDim ? spec.sort.by : `m_${spec.sort.by}`)} ${spec.sort.dir.toUpperCase()} NULLS LAST`;
  } else if (timeIndex >= 0) order = `"d${timeIndex}" ASC`;
  else if (dimKeys.length) order = `${ident(`m_${metrics[0]!.id}`)} DESC NULLS LAST`;
  if (order && dimKeys.length) order += `, ${dimKeys.map((k) => ident(k)).join(', ')}`;

  const limit = spec.limit ? ` LIMIT ${c.params.add(spec.limit, 'int')}` : '';
  const sql = `WITH ${c.ctes.join(',\n')}\n${select}${order ? ` ORDER BY ${order}` : ''}${limit}`;

  const columns: ResultColumn[] = [
    ...spec.dimensions.map((d, i) => ({
      key: `d${i}`,
      kind: 'dimension' as const,
      label: 'field' in d ? c.label(d.field) : TIME_LABELS[d.time],
      dimension: d,
    })),
    ...metrics.flatMap((m) => [
      {
        key: `m_${m.id}`,
        kind: 'metric' as const,
        label: m.def.label,
        format: m.def.format,
        metric: m.id,
      },
      ...(previous
        ? [
            {
              key: `m_${m.id}__prev`,
              kind: 'previous' as const,
              label: `${m.def.label} (before)`,
              format: m.def.format,
              metric: m.id,
            },
          ]
        : []),
    ]),
  ];
  const assumptions = [...new Set(metrics.flatMap((m) => m.def.assumptions))];
  return {
    sql,
    params: c.params.values,
    columns,
    assumptions,
    period,
    ...(previous ? { previousPeriod: previous } : {}),
  };
}

const TIME_LABELS: Record<TimeGrain, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year',
};
