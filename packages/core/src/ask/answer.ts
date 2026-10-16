import type { MetricFormat } from '@bizr/packs';

import type { Fact, Facts } from '../narration';
import type { ResultColumn } from '../semantic/compile';
import type { TimeGrain } from '../semantic/query-spec';
import type { AskCatalog } from './catalog';
import { decimalAbs, decimalCompare, decimalSub, isDecimal } from './decimal';
import type { ChartType, QuestionSpec } from './interpretation';
import { periodLabel, type Calendar, type Period } from './time';

/**
 * Turning a query result into an answer (AI_DESIGN Tasks E and §5): clean cells, facts for the
 * narration (every number comes from here, never from the model), a deterministic sentence for
 * when the AI isn't used, "How I calculated this", and the chart for the result's shape.
 */

export type Cell = string | number | null;

export interface AnswerColumn {
  key: string;
  label: string;
  kind: 'dimension' | 'metric' | 'previous';
  format?: MetricFormat;
  metric?: string;
  field?: string;
  time?: TimeGrain;
}

export interface AnswerData {
  columns: AnswerColumn[];
  rows: Record<string, Cell>[];
  /** Rows before the limit (for "top 10 of 48"). */
  totalRows: number;
  truncated: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A date cell as YYYY-MM-DD. `pg` parses dates as local midnight, so read it back locally. */
function isoDay(v: unknown): string | null {
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return typeof v === 'string' ? v.slice(0, 10) : null;
}

/** A plain value as text; anything else (objects, arrays) isn't a value we can show. */
function scalar(v: unknown): string | null {
  return typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean' ||
    typeof v === 'bigint'
    ? String(v)
    : null;
}

export function toAnswerData(result: {
  columns: readonly ResultColumn[];
  rows: readonly Record<string, unknown>[];
  truncated: boolean;
}): AnswerData {
  const columns: AnswerColumn[] = result.columns.map((c) => ({
    key: c.key,
    label: c.label,
    kind: c.kind,
    ...(c.format ? { format: c.format } : {}),
    ...(c.metric ? { metric: c.metric } : {}),
    ...(c.dimension && 'field' in c.dimension ? { field: c.dimension.field } : {}),
    ...(c.dimension && 'time' in c.dimension ? { time: c.dimension.time } : {}),
  }));
  const rows = result.rows.map((r) => {
    const out: Record<string, Cell> = {};
    for (const c of columns) {
      const v = r[c.key];
      if (v === null || v === undefined) out[c.key] = null;
      else if (c.time) out[c.key] = isoDay(v);
      else if (c.kind === 'dimension') out[c.key] = scalar(v);
      else if (c.format === 'money') {
        const s = scalar(v);
        out[c.key] = s !== null && isDecimal(s) ? s : null;
      } else {
        const n = Number(v);
        out[c.key] = Number.isFinite(n) ? n : null;
      }
    }
    return out;
  });
  const total = Number(result.rows[0]?.__total ?? rows.length);
  return {
    columns,
    rows,
    totalRows: Number.isFinite(total) ? total : rows.length,
    truncated: result.truncated,
  };
}

// --- Display ------------------------------------------------------------------------------------

/** How a time bucket reads: "13 Oct 2026", "Week of 12 Oct 2026", "Sep 2026", "Jul–Sep 2026", "2026". */
export function timeLabel(
  grain: TimeGrain,
  iso: string,
  cal: Pick<Calendar, 'fiscalYearStartMonth'>,
): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const mon = (i: number) => MONTHS[(i + 12) % 12]!;
  switch (grain) {
    case 'day':
      return `${d} ${mon(m - 1)} ${y}`;
    case 'week':
      return `Week of ${d} ${mon(m - 1)} ${y}`;
    case 'month':
      return `${mon(m - 1)} ${y}`;
    case 'quarter': {
      const endYear = m + 2 > 12 ? y + 1 : y;
      return `${mon(m - 1)}–${mon(m + 1)} ${endYear}`;
    }
    case 'year':
      return cal.fiscalYearStartMonth === 1
        ? String(y)
        : `${mon(m - 1)} ${y} – ${mon(m - 2)} ${y + 1}`;
  }
}

export interface DisplayContext {
  catalog: Pick<AskCatalog, 'dimensions' | 'calendar'>;
}

/** A breakdown value as the owner should read it. */
export function displayValue(col: AnswerColumn, cell: Cell, ctx: DisplayContext): string {
  if (cell === null) return col.time ? 'Unknown' : 'Not recorded';
  if (col.time) return timeLabel(col.time, String(cell), ctx.catalog.calendar);
  const dim = ctx.catalog.dimensions.find((d) => d.field === col.field);
  return dim?.valueLabels[String(cell)] ?? String(cell);
}

// --- Facts --------------------------------------------------------------------------------------

export interface AnswerFacts {
  facts: Facts;
  /** For the AI: what each placeholder means (never its value). */
  meanings: { name: string; meaning: string }[];
}

export interface FactContext extends DisplayContext {
  /** Only the sort matters for facts ("highest first"). */
  spec: Pick<QuestionSpec, 'orderBy'>;
  period?: Period;
  previousPeriod?: Period;
}

function valueFact(format: MetricFormat | undefined, cell: Cell): Fact | undefined {
  if (cell === null) return undefined;
  switch (format) {
    case 'money':
      return { kind: 'money', value: String(cell) };
    case 'percent':
      return { kind: 'percent', value: Number(cell) };
    case 'days': {
      const days = Math.round(Number(cell));
      return { kind: 'count', value: days, one: 'day', other: 'days' };
    }
    default:
      return { kind: 'number', value: Number(cell) };
  }
}

export function answerFacts(data: AnswerData, ctx: FactContext): AnswerFacts {
  const facts: Facts = {};
  const meanings: AnswerFacts['meanings'] = [];
  const add = (name: string, meaning: string, fact: Fact | undefined) => {
    if (!fact) return;
    facts[name] = fact;
    meanings.push({ name, meaning });
  };
  const metrics = data.columns.filter((c) => c.kind === 'metric');
  const prevOf = (c: AnswerColumn) =>
    data.columns.find((p) => p.kind === 'previous' && p.metric === c.metric);
  const dims = data.columns.filter((c) => c.kind === 'dimension');
  const primary = metrics[0];
  if (!primary) return { facts, meanings };

  if (ctx.period)
    add('period', 'the time covered, e.g. “September 2026”', text(periodLabel(ctx.period)));
  if (ctx.previousPeriod)
    add('previous_period', 'the time compared with', text(periodLabel(ctx.previousPeriod)));

  /** Value, earlier value, direction and change of one metric in one row. */
  const valueWithChange = (
    prefix: string,
    about: string,
    c: AnswerColumn,
    row: Record<string, Cell>,
  ) => {
    const cur = row[c.key] ?? null;
    add(prefix, `${c.label.toLowerCase()} ${about}`, valueFact(c.format, cur));
    const p = prevOf(c);
    if (!p) return;
    const before = row[p.key] ?? null;
    add(
      `${prefix}_before`,
      `${c.label.toLowerCase()} ${about}, in the time compared with`,
      valueFact(c.format, before),
    );
    if (cur === null || before === null) return;
    const change = changeOf(c.format, cur, before);
    add(
      `${prefix}_direction`,
      `“up”, “down” or “the same” for ${c.label.toLowerCase()} ${about}`,
      text(change.direction),
    );
    if (change.direction === 'the same') return;
    add(
      `${prefix}_change`,
      `how much ${c.label.toLowerCase()} ${about} changed (always positive; use the direction word)${
        c.format === 'percent' ? ', in percentage points' : ''
      }`,
      change.amount,
    );
    if (change.pct !== undefined)
      add(
        `${prefix}_change_pct`,
        `the change in ${c.label.toLowerCase()} ${about} as a percentage (always positive)`,
        {
          kind: 'percent',
          value: change.pct,
        },
      );
  };

  if (dims.length === 0) {
    const row = data.rows[0] ?? {};
    for (const c of metrics) valueWithChange(c.metric!, 'in total', c, row);
    return { facts, meanings };
  }

  const fieldDims = dims.filter((d) => !d.time);
  const timeDim = dims.find((d) => d.time);
  const labelOf = (row: Record<string, Cell>) =>
    dims.map((d) => displayValue(d, row[d.key] ?? null, ctx)).join(', ');
  const noun = nounFor(fieldDims[0], ctx);

  if (timeDim && fieldDims.length === 0) {
    const points = data.rows.filter((r) => r[primary.key] !== null);
    const latest = points.at(-1);
    if (latest) {
      add('latest_label', `the most recent ${timeDim.time}`, text(labelOf(latest)));
      valueWithChange('latest_value', `in the most recent ${timeDim.time}`, primary, latest);
    }
    const sorted = [...points].sort((a, b) =>
      compareCells(primary.format, a[primary.key]!, b[primary.key]!),
    );
    const high = sorted.at(-1);
    const low = sorted[0];
    if (high && points.length > 1) {
      add(
        'highest_label',
        `the ${timeDim.time} with the highest ${primary.label.toLowerCase()}`,
        text(labelOf(high)),
      );
      add(
        'highest_value',
        `${primary.label.toLowerCase()} in that ${timeDim.time}`,
        valueFact(primary.format, high[primary.key]!),
      );
    }
    if (low && points.length > 2) {
      add(
        'lowest_label',
        `the ${timeDim.time} with the lowest ${primary.label.toLowerCase()}`,
        text(labelOf(low)),
      );
      add(
        'lowest_value',
        `${primary.label.toLowerCase()} in that ${timeDim.time}`,
        valueFact(primary.format, low[primary.key]!),
      );
    }
    add('point_count', `number of ${timeDim.time}s shown, with the word`, {
      kind: 'count',
      value: data.rows.length,
      one: timeDim.time!,
      other: `${timeDim.time}s`,
    });
    return { facts, meanings };
  }

  const dir = ctx.spec.orderBy?.dir ?? 'desc';
  const order = dir === 'desc' ? 'highest' : 'lowest';
  // "Who are my best customers?" shouldn't name "Not recorded": rank only rows with every breakdown.
  const named = data.rows.filter((r) => fieldDims.every((d) => r[d.key] !== null));
  named.slice(0, 3).forEach((row, i) => {
    const n = i + 1;
    add(
      `top${n}_label`,
      `the ${ordinal(n)} in the list (${order} ${primary.label.toLowerCase()} first)`,
      text(labelOf(row)),
    );
    valueWithChange(`top${n}_value`, `for the ${ordinal(n)} in the list`, primary, row);
    for (const c of metrics.slice(1))
      add(
        `top${n}_${c.metric}`,
        `${c.label.toLowerCase()} for the ${ordinal(n)} in the list`,
        valueFact(c.format, row[c.key] ?? null),
      );
  });
  const last = named.at(-1);
  if (last && named.length > 3) {
    add('last_label', 'the last one in the list', text(labelOf(last)));
    add(
      'last_value',
      `${primary.label.toLowerCase()} for the last one in the list`,
      valueFact(primary.format, last[primary.key] ?? null),
    );
  }
  add('shown_count', `how many ${noun[1]} are listed (just the number)`, {
    kind: 'number',
    value: data.rows.length,
  });
  if (data.totalRows > data.rows.length)
    add(
      'total_count',
      `how many ${noun[1]} there are in all (more than listed), with the word`,
      count(data.totalRows, noun),
    );
  return { facts, meanings };
}

const text = (value: string): Fact => ({ kind: 'text', value });
const count = (value: number, noun: [string, string]): Fact => ({
  kind: 'count',
  value,
  one: noun[0],
  other: noun[1],
});
const ordinal = (n: number) => ['first', 'second', 'third'][n - 1] ?? `number ${n}`;

function nounFor(col: AnswerColumn | undefined, ctx: DisplayContext): [string, string] {
  return ctx.catalog.dimensions.find((d) => d.field === col?.field)?.noun ?? ['result', 'results'];
}

function compareCells(format: MetricFormat | undefined, a: Cell, b: Cell): number {
  if (format === 'money') return decimalCompare(String(a), String(b));
  return Number(a) - Number(b);
}

function changeOf(
  format: MetricFormat | undefined,
  cur: Cell,
  before: Cell,
): { direction: 'up' | 'down' | 'the same'; amount?: Fact; pct?: number } {
  const c = Number(cur);
  const b = Number(before);
  const pct = b !== 0 ? Math.abs((c - b) / b) : undefined;
  if (format === 'money') {
    const diff = decimalSub(String(cur), String(before));
    const cmp = decimalCompare(diff, '0');
    if (cmp === 0) return { direction: 'the same' };
    return {
      direction: cmp > 0 ? 'up' : 'down',
      amount: { kind: 'money', value: decimalAbs(diff) },
      ...(pct !== undefined ? { pct } : {}),
    };
  }
  if (c === b) return { direction: 'the same' };
  return {
    direction: c > b ? 'up' : 'down',
    amount: valueFact(format, Math.abs(c - b)),
    ...(pct !== undefined && format !== 'percent' ? { pct } : {}),
  };
}

// --- Deterministic wording ----------------------------------------------------------------------

/** Braces in labels (owner text) would read as placeholders. */
const lit = (s: string) => s.replace(/[{}]/g, '');

/**
 * The answer sentence without AI: used when the AI is off, over budget, or wrote something that
 * failed the checks. Same placeholders as the AI's, so every number still comes from the facts.
 */
export function templateAnswer(data: AnswerData, f: AnswerFacts, ctx: FactContext): string {
  const has = (n: string) => n in f.facts;
  const metrics = data.columns.filter((c) => c.kind === 'metric');
  const primary = metrics[0];
  if (!primary) return 'There’s nothing to show for this yet.';
  const label = lit(primary.label.toLowerCase());
  const when = has('period') ? ' in {{period}}' : '';
  const change = (prefix: string) =>
    !has(`${prefix}_direction`)
      ? ''
      : f.facts[`${prefix}_direction`]?.kind === 'text' &&
          (f.facts[`${prefix}_direction`] as { value: string }).value === 'the same'
        ? ' That’s the same as {{previous_period}}.'
        : ` That’s {{${prefix}_direction}} ${has(`${prefix}_change_pct`) ? `{{${prefix}_change_pct}}` : `{{${prefix}_change}}`} on {{previous_period}}.`;

  if (
    data.rows.length === 0 ||
    (data.columns.some((c) => c.kind === 'dimension') && !has('top1_label') && !has('latest_label'))
  )
    return `I didn’t find any records for this${when}.`;

  const dims = data.columns.filter((c) => c.kind === 'dimension');
  if (dims.length === 0) {
    if (!has(primary.metric!)) return `There’s no ${label} to show${when}.`;
    const parts = [
      `Your ${label}${when} ${metrics.length > 1 || !when ? 'is' : 'was'} {{${primary.metric}}}.${change(primary.metric!)}`,
    ];
    for (const c of metrics.slice(1))
      if (has(c.metric!)) parts.push(`${lit(c.label)}: {{${c.metric}}}.`);
    return parts.join(' ');
  }

  if (has('latest_label')) {
    const parts = [`In {{latest_label}}, ${label} was {{latest_value}}.${change('latest_value')}`];
    if (has('highest_label'))
      parts.push(`The highest was {{highest_label}}, with {{highest_value}}.`);
    return parts.join(' ');
  }

  const asc = ctx.spec.orderBy?.dir === 'asc';
  const first = asc
    ? `{{top1_label}} has the lowest ${label}${when}: {{top1_value}}.`
    : `{{top1_label}} had the highest ${label}${when}, with {{top1_value}}.`;
  const parts = [`${first}${change('top1_value')}`];
  if (has('top2_label')) parts.push('Next is {{top2_label}} with {{top2_value}}.');
  if (has('total_count')) parts.push('Showing the top {{shown_count}} of {{total_count}}.');
  return parts.join(' ');
}

// --- How I calculated this ----------------------------------------------------------------------

const OPS: Record<string, string> = {
  eq: 'is',
  neq: 'isn’t',
  in: 'is one of',
  not_in: 'isn’t one of',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  contains: 'contains',
};

/** Plain-language steps for "How I calculated this", written by code from the spec. */
export function explainSpec(
  spec: QuestionSpec,
  ctx: Omit<FactContext, 'spec'> & {
    metrics: { id: string; label: string; description: string; snapshot: boolean }[];
    assumptions: readonly string[];
  },
): string[] {
  const steps: string[] = [];
  for (const id of spec.metrics) {
    const m = ctx.metrics.find((x) => x.id === id);
    if (m) steps.push(`${m.label}: ${m.description}`);
  }
  const snapshotOnly = spec.metrics.every((id) => ctx.metrics.find((m) => m.id === id)?.snapshot);
  if (snapshotOnly) steps.push('This is how things stand right now, from your latest records.');
  else if (ctx.period) {
    const covers = periodLabel(ctx.period);
    steps.push(
      ctx.previousPeriod
        ? `Covers ${covers}, compared with ${periodLabel(ctx.previousPeriod)}.`
        : `Covers ${covers}.`,
    );
  } else steps.push('Covers all your records.');
  const dimLabel = (field: string) =>
    ctx.catalog.dimensions.find((d) => d.field === field)?.label.toLowerCase() ?? field;
  const split = spec.dimensions.map((d) => ('time' in d ? d.time : dimLabel(d.field)));
  if (split.length) steps.push(`Split by ${split.join(' and ')}.`);
  for (const f of spec.filters) {
    const dim = ctx.catalog.dimensions.find((d) => d.field === f.field);
    const vals = f.values.map((v) => dim?.valueLabels[String(v)] ?? String(v)).join(', ');
    steps.push(`Only where ${dim?.label.toLowerCase() ?? f.field} ${OPS[f.op] ?? f.op} ${vals}.`);
  }
  for (const h of spec.having) {
    const m = ctx.metrics.find((x) => x.id === h.metric);
    steps.push(`Only where ${m?.label.toLowerCase() ?? h.metric} ${OPS[h.op] ?? h.op} ${h.value}.`);
  }
  if (spec.orderBy && spec.dimensions.some((d) => 'field' in d)) {
    const by = ctx.metrics.find((x) => x.id === spec.orderBy!.by)?.label.toLowerCase() ?? 'name';
    steps.push(
      `Sorted by ${by}, ${spec.orderBy.dir === 'desc' ? 'highest' : 'lowest'} first${
        spec.limit ? `; the top ${spec.limit} shown` : ''
      }.`,
    );
  }
  for (const a of ctx.assumptions) if (!steps.includes(a)) steps.push(a);
  return steps;
}

// --- Chart --------------------------------------------------------------------------------------

/** The chart for a result's shape (AI_DESIGN §5). A preference is used only when it fits. */
export function chooseChart(
  data: AnswerData,
  spec: Pick<QuestionSpec, 'having'>,
  preference?: ChartType,
): ChartType {
  const dims = data.columns.filter((c) => c.kind === 'dimension');
  const metrics = data.columns.filter((c) => c.kind === 'metric');
  const time = dims.filter((d) => d.time);
  const fields = dims.filter((d) => !d.time);
  const categories = fields[0] ? new Set(data.rows.map((r) => r[fields[0]!.key])).size : 0;
  const additive = metrics.every((m) => m.format === 'money' || m.format === 'number');

  const fits = (c: ChartType): boolean => {
    switch (c) {
      case 'table':
        return true;
      case 'kpi':
        return dims.length === 0 && metrics.length <= 4;
      case 'line':
        return (
          time.length === 1 &&
          (fields.length === 0 ? metrics.length <= 2 : metrics.length === 1 && categories <= 6)
        );
      case 'bar':
        return time.length === 1 && fields.length === 0 && metrics.length <= 2;
      case 'stacked_bar':
        return (
          time.length === 1 &&
          fields.length === 1 &&
          metrics.length === 1 &&
          categories <= 6 &&
          additive
        );
      case 'bar_horizontal':
        return (
          time.length === 0 && fields.length === 1 && metrics.length === 1 && data.rows.length <= 50
        );
    }
  };
  if (preference && fits(preference)) return preference;
  if (dims.length === 0) return metrics.length <= 4 ? 'kpi' : 'table';
  // "Which customers owe me money?" is a list.
  if (spec.having.length > 0) return 'table';
  if (time.length === 1 && fields.length === 0)
    return metrics.length > 2 ? 'table' : data.rows.length <= 6 ? 'bar' : 'line';
  if (time.length === 1 && fields.length === 1 && metrics.length === 1 && categories <= 6)
    return additive ? 'stacked_bar' : 'line';
  if (time.length === 0 && fields.length === 1 && metrics.length === 1 && data.rows.length <= 15)
    return 'bar_horizontal';
  return 'table';
}
