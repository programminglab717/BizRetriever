import { displayValue, type AnswerData, type Cell } from '../ask/answer';
import type { ViewOptions } from '../ask/view';
import type { FieldMeta } from '../records/service';

/**
 * A download (ADR-056): one or more sheets of plain values, built by code from an executed query or
 * from the records themselves. Writers turn a sheet into CSV or Excel; nothing is recalculated.
 */

export type ColumnType = 'text' | 'number' | 'money' | 'percent' | 'date' | 'datetime';

export interface SheetColumn {
  label: string;
  type: ColumnType;
}

/**
 * Money and record numbers are exact decimal strings; percents are fractions (0.25 is 25%); dates are
 * `YYYY-MM-DD` and date-times local `YYYY-MM-DDTHH:MM:SS`.
 */
export type SheetCell = string | number | null;

export interface Sheet {
  name: string;
  columns: SheetColumn[];
  rows: SheetCell[][];
}

/** The answer's columns and rows as values, with labels the owner saw ("Sep 2026", "Website"). */
export function answerSheet(
  name: string,
  data: AnswerData,
  o: ViewOptions & { comparedWith?: string | undefined },
): Sheet {
  const ctx = {
    catalog: {
      calendar: { today: '', weekStart: 1, fiscalYearStartMonth: o.fiscalYearStartMonth },
      dimensions: o.pack.metrics.dimensions.map((d) => ({
        field: d.field,
        label: d.label,
        synonyms: d.synonyms,
        values: [],
        valueSynonyms: {},
        valueLabels: d.value_labels,
        noun: d.noun ?? ['result', 'results'],
      })),
    },
  };
  const columns = data.columns.map((c): SheetColumn & { cell: (v: Cell) => SheetCell } => {
    if (c.kind === 'dimension') {
      if (c.time === 'day') return { label: c.label, type: 'date', cell: (v) => v };
      return { label: c.label, type: 'text', cell: (v) => displayValue(c, v, ctx) };
    }
    const label =
      c.kind === 'previous' && o.comparedWith
        ? c.label.replace(/\(before\)$/, `(${o.comparedWith})`)
        : c.label;
    switch (c.format) {
      case 'money':
        return { label: `${label} (${o.currency})`, type: 'money', cell: (v) => v };
      case 'percent':
        return { label, type: 'percent', cell: (v) => (v === null ? null : Number(v)) };
      default:
        return { label, type: 'number', cell: (v) => (v === null ? null : Number(v)) };
    }
  });
  return {
    name,
    columns: columns.map(({ label, type }) => ({ label, type })),
    rows: data.rows.map((r) => columns.map((c, i) => c.cell(r[data.columns[i]!.key] ?? null))),
  };
}

/** A record field as a download column. Linked records show by name, coded values by label. */
export function fieldColumn(
  f: FieldMeta,
  currency: string,
  /** Yes and No in the reader's language (M20). */
  [yes, no]: [string?, string?] = [],
): SheetColumn & {
  cell: (v: string | null) => SheetCell;
} {
  switch (f.type) {
    case 'money':
      return { label: `${f.label} (${currency})`, type: 'money', cell: (v) => v };
    case 'integer':
    case 'decimal':
      return { label: f.label, type: 'number', cell: (v) => v };
    case 'percent':
      return { label: f.label, type: 'percent', cell: (v) => v };
    case 'date':
      return { label: f.label, type: 'date', cell: (v) => v };
    case 'datetime':
      return { label: f.label, type: 'datetime', cell: (v) => v };
    case 'boolean':
      return {
        label: f.label,
        type: 'text',
        cell: (v) => (v === null ? null : v === 'true' ? (yes ?? 'Yes') : (no ?? 'No')),
      };
    default:
      return {
        label: f.label,
        type: 'text',
        cell: (v) => (v === null ? null : (f.valueLabels?.[v] ?? v)),
      };
  }
}

/** A file name from a title: letters, digits, spaces and dashes only. */
export function fileNameFor(title: string, ext: 'csv' | 'xlsx' | 'pdf'): string {
  const base =
    title
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'download';
  return `${base}.${ext}`;
}
