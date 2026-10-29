import type { Language } from '@bizr/i18n';
import type { MetricFormat, PackData } from '@bizr/packs';

import type { Segment } from '../narration';
import {
  displayValue,
  type AnswerColumn,
  type AnswerData,
  type Cell,
  type DisplayContext,
} from './answer';
import { decimalSub } from './decimal';
import type { ChartType } from './interpretation';
import type { AnswerContent, AskResult } from './service';

/**
 * What the Ask screen and dashboard tiles render: every value already formatted by code, plus plain
 * numbers for plotting only. Plain JSON, so it can cross from server to client components.
 */

/** Where each currency is at home, for Spanish number style ("$22,489.20" in es-US). */
const SPANISH_BY_CURRENCY: Record<string, string> = {
  USD: 'es-US',
  EUR: 'es-ES',
  MXN: 'es-MX',
  COP: 'es-CO',
  ARS: 'es-AR',
  CLP: 'es-CL',
  PEN: 'es-PE',
  UYU: 'es-UY',
  DOP: 'es-DO',
  GTQ: 'es-GT',
  CRC: 'es-CR',
};

/**
 * Number and date style for a workspace's settings, in the reader's language (M20): in Spanish,
 * the style of a country whose money it is (dollars as in the US, euros as in Spain).
 */
export function localeFor(
  settings: { dateOrder: string; currency?: string },
  lang: Language = 'en',
): string {
  if (lang === 'es') return SPANISH_BY_CURRENCY[settings.currency ?? ''] ?? 'es-US';
  return settings.dateOrder === 'DMY' ? 'en-GB' : settings.dateOrder === 'YMD' ? 'en-CA' : 'en-US';
}

export interface ViewColumn {
  key: string;
  label: string;
  kind: 'dimension' | 'metric';
  format?: MetricFormat;
}

export interface ViewRow {
  key: string;
  /** The breakdown values joined ("Etsy", "Sep 2026, Etsy"). */
  label: string;
  cells: { text: string; value: number | null }[];
}

export interface KpiView {
  label: string;
  text: string;
  change?: { direction: 'up' | 'down' | 'same'; text: string; good?: boolean };
}

export interface TableView {
  columns: ViewColumn[];
  rows: ViewRow[];
  totalRows: number;
  /** For stacked bars: the time column and the category column, when the shape has both. */
  series?: { x: number; group: number };
}

export interface AnswerView {
  id: string;
  question: string;
  kind: AskResult['kind'];
  title: string;
  headline?: Segment[];
  chart?: ChartType;
  table?: TableView;
  kpis?: KpiView[];
  comparedWith?: string;
  assumptions: string[];
  steps?: string[];
  details?: AnswerContent['details'];
  clarify?: AnswerContent['clarify'];
  unanswerable?: AnswerContent['unanswerable'];
  error?: string;
  fixedDates: boolean;
  feedback: number | null;
  pinned: boolean;
}

export interface ViewOptions {
  pack: Pick<PackData, 'metrics'> & Partial<Pick<PackData, 'translations'>>;
  locale: string;
  currency: string;
  fiscalYearStartMonth: number;
}

export function formatValue(format: MetricFormat | undefined, cell: Cell, o: ViewOptions): string {
  if (cell === null) return '–';
  const n = (v: number, opts?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat(o.locale, opts).format(v);
  switch (format) {
    case 'money':
      // Intl formats decimal strings exactly; the lib typings lag behind.
      return new Intl.NumberFormat(o.locale, { style: 'currency', currency: o.currency }).format(
        String(cell) as unknown as number,
      );
    case 'percent':
      return n(Number(cell), { style: 'percent', maximumFractionDigits: 1 });
    case 'days': {
      const d = Math.round(Number(cell));
      if (langOf(o) === 'es') return `${n(d)} ${d === 1 ? 'día' : 'días'}`;
      return `${n(d)} ${d === 1 ? 'day' : 'days'}`;
    }
    default:
      return n(Number(cell), { maximumFractionDigits: 2 });
  }
}

/** The reader's language follows from the locale `localeFor` gave (M20). */
const langOf = (o: ViewOptions): Language => (o.locale.startsWith('es') ? 'es' : 'en');

function displayContext(o: ViewOptions): DisplayContext {
  const lang = langOf(o);
  const tr = lang === 'es' ? o.pack.translations?.es?.dimensions : undefined;
  return {
    catalog: {
      calendar: { today: '', weekStart: 1, fiscalYearStartMonth: o.fiscalYearStartMonth },
      dimensions: o.pack.metrics.dimensions.map((d) => ({
        field: d.field,
        label: tr?.[d.field]?.label ?? d.label,
        synonyms: d.synonyms,
        values: [],
        valueSynonyms: {},
        valueLabels: { ...d.value_labels, ...(tr?.[d.field]?.value_labels ?? {}) },
        noun: tr?.[d.field]?.noun ?? d.noun ?? ['result', 'results'],
      })),
      lang,
    },
  };
}

export function tableView(data: AnswerData, o: ViewOptions): TableView {
  const ctx = displayContext(o);
  const columns = data.columns.filter((c) => c.kind !== 'previous');
  const dims = columns.filter((c) => c.kind === 'dimension');
  const rows = data.rows.map((r, i) => {
    const cells = columns.map((c) => cellView(c, r[c.key] ?? null, ctx, o));
    return {
      key: String(i),
      label: dims.map((d) => displayValue(d, r[d.key] ?? null, ctx)).join(', '),
      cells,
    };
  });
  const time = columns.findIndex((c) => c.kind === 'dimension' && c.time);
  const group = columns.findIndex((c) => c.kind === 'dimension' && !c.time);
  return {
    columns: columns.map((c) => ({
      key: c.key,
      label: c.label,
      kind: c.kind === 'dimension' ? 'dimension' : 'metric',
      ...(c.format ? { format: c.format } : {}),
    })),
    rows,
    totalRows: data.totalRows,
    ...(time >= 0 && group >= 0 ? { series: { x: time, group } } : {}),
  };
}

function cellView(c: AnswerColumn, cell: Cell, ctx: DisplayContext, o: ViewOptions) {
  if (c.kind === 'dimension') return { text: displayValue(c, cell, ctx), value: null };
  const value = cell === null ? null : Number(cell);
  return { text: formatValue(c.format, cell, o), value: Number.isFinite(value) ? value : null };
}

/** Headline numbers for a result with no breakdown, with the change when there's a comparison. */
export function kpiViews(data: AnswerData, o: ViewOptions): KpiView[] {
  const row = data.rows[0];
  if (!row || data.columns.some((c) => c.kind === 'dimension')) return [];
  return data.columns
    .filter((c) => c.kind === 'metric')
    .map((c) => {
      const cur = row[c.key] ?? null;
      const prevCol = data.columns.find((p) => p.kind === 'previous' && p.metric === c.metric);
      const kpi: KpiView = { label: c.label, text: formatValue(c.format, cur, o) };
      const before = prevCol ? (row[prevCol.key] ?? null) : null;
      if (!prevCol || cur === null || before === null) return kpi;
      const diff =
        c.format === 'money'
          ? Number(decimalSub(String(cur), String(before)))
          : Number(cur) - Number(before);
      const direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
      const goodDir = o.pack.metrics.metrics.find((m) => m.id === c.metric)?.good_direction ?? 'up';
      const b = Number(before);
      const text =
        direction === 'same'
          ? 'No change'
          : c.format === 'percent'
            ? `${formatValue('number', Math.abs(diff) * 100, o)} points`
            : b !== 0
              ? formatValue('percent', Math.abs(diff / b), o)
              : formatValue(
                  c.format,
                  c.format === 'money'
                    ? decimalSub(String(cur), String(before)).replace('-', '')
                    : Math.abs(diff),
                  o,
                );
      return {
        ...kpi,
        change: {
          direction,
          text,
          ...(direction !== 'same' && goodDir !== 'neutral' ? { good: direction === goodDir } : {}),
        },
      };
    });
}

export function answerView(r: AskResult, o: ViewOptions): AnswerView {
  const c = r.content;
  return {
    id: r.answerId,
    question: r.question,
    kind: r.kind,
    title: c.title,
    ...(c.headline ? { headline: c.headline } : {}),
    ...(c.chart ? { chart: c.chart } : {}),
    ...(c.data ? { table: tableView(c.data, o), kpis: kpiViews(c.data, o) } : {}),
    ...(c.comparedWith ? { comparedWith: c.comparedWith } : {}),
    assumptions: c.assumptions,
    ...(c.steps ? { steps: c.steps } : {}),
    ...(c.details ? { details: c.details } : {}),
    ...(c.clarify ? { clarify: c.clarify } : {}),
    ...(c.unanswerable ? { unanswerable: c.unanswerable } : {}),
    ...(c.error ? { error: c.error } : {}),
    fixedDates: c.fixedDates ?? false,
    feedback: r.feedback,
    pinned: r.pinned,
  };
}
