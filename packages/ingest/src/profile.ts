import { isEmptyCell, type Cell, type RawSheet } from './grid';
import { countRowKinds, dataRowIndices, type Region, type RowKind } from './regions';
import { parseDate, type DateOrder } from './values/dates';
import { parseNumber } from './values/numbers';
import { detectPii, maskPii, type PiiKind } from './values/pii';
import { isNullSentinel, normalizeKey, sanitizeText, valueShape } from './values/text';

/**
 * Column statistics for one region. This, plus a few masked sample rows, is everything the AI ever
 * sees of a file (ARCHITECTURE §2): never whole files, never unmasked contact details.
 */

export interface ColumnProfile {
  index: number;
  header: string;
  filled: number;
  blank: number;
  /** Distinct non-empty values (capped at 10,000). */
  distinct: number;
  kinds: {
    number: number;
    integer: number;
    money: number;
    percent: number;
    withUnit: number;
    date: number;
    dateWithTime: number;
    boolean: number;
    text: number;
  };
  number?: { min: number; max: number; negative: number; maxDecimals: number };
  date?: {
    min: string;
    max: string;
    formats: Record<string, number>;
    /** Values that only make sense day-first (e.g. 25/03/2026) or month-first (03/25/2026). */
    dayFirstOnly: number;
    monthFirstOnly: number;
    ambiguous: number;
    /** What the values themselves say, if they say anything. */
    impliedOrder?: DateOrder;
  };
  currencies: Record<string, number>;
  units: Record<string, number>;
  nullSentinels: Record<string, number>;
  pii?: PiiKind;
  shapes: { shape: string; count: number }[];
  topValues: { value: string; count: number }[];
  samples: string[];
  /** Groups of different spellings that normalise to the same name (e.g. "Bloom & Co" / "BLOOM & CO LTD"). */
  nearDuplicates: { key: string; variants: string[] }[];
  /**
   * Blank on rows that continue the previous row's group (same value in the group key column, e.g.
   * the order number on line-level exports): a strong hint the column needs filling down.
   */
  blankWithinGroup: number;
}

export interface RegionProfile {
  regionId: string;
  sheetName: string;
  headerRows: number[];
  rowCounts: Record<RowKind, number>;
  /** Distinct section labels, e.g. product categories written as rows. */
  sections: string[];
  columns: ColumnProfile[];
  /** Column whose value repeats on consecutive rows (e.g. order number on line-level exports). */
  groupKeyColumn?: number;
  /** Columns whose headers are month names (wide format, e.g. Jan…Dec). */
  monthColumns: number[];
  /** The first rows of data, sanitised and masked, for the AI to look at. */
  sampleRows: string[][];
  headerConfidence: number;
}

export interface ProfileOptions {
  dateOrder: DateOrder;
  /** Mask emails/phones/cards in samples (workspace setting, default on). */
  maskPii: boolean;
  sampleRows?: number;
  samplesPerColumn?: number;
}

const BOOLEAN_WORDS = new Set([
  'y',
  'n',
  'yes',
  'no',
  'true',
  'false',
  '✓',
  '✔',
  'x',
  'paid',
  'unpaid',
  'part',
  'partial',
]);
const MONTH_HEADER =
  /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(\s+'?\d{2,4})?$/i;
const DISTINCT_CAP = 10_000;

function display(cell: Cell): string {
  if (cell instanceof Date) {
    const iso = cell.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
  }
  return sanitizeText(String(cell));
}

export function profileRegion(
  sheet: RawSheet,
  region: Region,
  options: ProfileOptions,
): RegionProfile {
  const rows = dataRowIndices(region);
  const samplesPerColumn = options.samplesPerColumn ?? 20;
  const groupKey = findGroupKey(sheet, region, rows);
  const continuesGroup = rows.map((r, i) => {
    if (groupKey === undefined || i === 0) return false;
    const a = sheet.rows[r]![groupKey] ?? null;
    const b = sheet.rows[rows[i - 1]!]![groupKey] ?? null;
    return !isEmptyCell(a) && display(a) === display(b ?? null);
  });

  const columns: ColumnProfile[] = region.columns.map((col) => {
    const counts = new Map<string, number>();
    const kinds: ColumnProfile['kinds'] = {
      number: 0,
      integer: 0,
      money: 0,
      percent: 0,
      withUnit: 0,
      date: 0,
      dateWithTime: 0,
      boolean: 0,
      text: 0,
    };
    const currencies: Record<string, number> = {};
    const units: Record<string, number> = {};
    const sentinels: Record<string, number> = {};
    const shapes = new Map<string, number>();
    const piiKinds = new Map<PiiKind, number>();
    let filled = 0;
    let blank = 0;
    let blankWithinGroup = 0;
    let nMin = Infinity;
    let nMax = -Infinity;
    let negative = 0;
    let maxDecimals = 0;
    let dMin = '9999-12-31';
    let dMax = '0000-01-01';
    const dateFormats: Record<string, number> = {};
    let dayFirstOnly = 0;
    let monthFirstOnly = 0;
    let ambiguous = 0;

    rows.forEach((r, i) => {
      const cell = sheet.rows[r]![col.index] ?? null;
      if (isEmptyCell(cell)) {
        blank += 1;
        if (continuesGroup[i]) blankWithinGroup += 1;
        return;
      }
      filled += 1;
      const text = display(cell);
      if (counts.size < DISTINCT_CAP || counts.has(text))
        counts.set(text, (counts.get(text) ?? 0) + 1);

      if (typeof cell === 'string' && isNullSentinel(cell)) {
        sentinels[cell.trim()] = (sentinels[cell.trim()] ?? 0) + 1;
        return;
      }
      const date = parseDate(cell);
      if (date) {
        kinds.date += 1;
        if (date.time) kinds.dateWithTime += 1;
        dateFormats[date.format] = (dateFormats[date.format] ?? 0) + 1;
        if (date.ambiguous) ambiguous += 1;
        else if (date.format.startsWith('D') && /^D[-/.]/.test(date.format)) dayFirstOnly += 1;
        else if (/^M[-/.]/.test(date.format)) monthFirstOnly += 1;
        if (date.date < dMin) dMin = date.date;
        if (date.date > dMax) dMax = date.date;
        return;
      }
      const num = parseNumber(cell);
      if (num) {
        kinds.number += 1;
        if (Number.isInteger(num.value)) kinds.integer += 1;
        if (num.currency) {
          kinds.money += 1;
          currencies[num.currency] = (currencies[num.currency] ?? 0) + 1;
        }
        if (num.percent) kinds.percent += 1;
        if (num.unit) {
          kinds.withUnit += 1;
          units[num.unit] = (units[num.unit] ?? 0) + 1;
        }
        if (num.value < 0) negative += 1;
        nMin = Math.min(nMin, num.value);
        nMax = Math.max(nMax, num.value);
        const decimals = String(num.value).split('.')[1]?.length ?? 0;
        maxDecimals = Math.max(maxDecimals, decimals);
        return;
      }
      if (
        typeof cell === 'boolean' ||
        (typeof cell === 'string' && BOOLEAN_WORDS.has(cell.trim().toLowerCase()))
      ) {
        kinds.boolean += 1;
        return;
      }
      kinds.text += 1;
      if (typeof cell === 'string') {
        const shape = valueShape(cell.trim());
        shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
        const pii = detectPii(cell);
        if (pii) piiKinds.set(pii, (piiKinds.get(pii) ?? 0) + 1);
      }
    });

    // PII if most text values are of one kind.
    let pii: PiiKind | undefined;
    for (const [kind, n] of piiKinds) if (n >= Math.max(1, kinds.text * 0.6)) pii = kind;
    const mask = (v: string) => {
      if (!options.maskPii) return v;
      const kind = detectPii(v);
      return kind ? maskPii(v, kind) : v;
    };

    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const profile: ColumnProfile = {
      index: col.index,
      header: sanitizeText(col.header),
      filled,
      blank,
      distinct: counts.size,
      kinds,
      currencies,
      units,
      nullSentinels: sentinels,
      shapes: [...shapes.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([shape, count]) => ({ shape, count })),
      topValues: sorted.slice(0, 10).map(([value, count]) => ({ value: mask(value), count })),
      samples: spreadSample(
        sorted.map(([v]) => v),
        samplesPerColumn,
      ).map(mask),
      nearDuplicates:
        kinds.text > 0 && counts.size <= 5_000 ? nearDuplicates(sorted.map(([v]) => v)) : [],
      blankWithinGroup,
    };
    if (pii) profile.pii = pii;
    if (kinds.number > 0) profile.number = { min: nMin, max: nMax, negative, maxDecimals };
    if (kinds.date > 0) {
      profile.date = {
        min: dMin,
        max: dMax,
        formats: dateFormats,
        dayFirstOnly,
        monthFirstOnly,
        ambiguous,
      };
      if (dayFirstOnly > 0 && monthFirstOnly === 0) profile.date.impliedOrder = 'DMY';
      if (monthFirstOnly > 0 && dayFirstOnly === 0) profile.date.impliedOrder = 'MDY';
    }
    return profile;
  });

  const sampleCount = options.sampleRows ?? 15;
  const sampleRows = rows.slice(0, sampleCount).map((r) =>
    region.columns.map((c) => {
      const cell = sheet.rows[r]![c.index] ?? null;
      if (isEmptyCell(cell)) return '';
      const v = display(cell);
      const kind = options.maskPii ? detectPii(v) : undefined;
      return kind ? maskPii(v, kind) : v;
    }),
  );

  return {
    regionId: region.id,
    sheetName: sanitizeText(region.sheetName),
    headerRows: region.headerRows,
    rowCounts: countRowKinds(region),
    sections: [...new Set(region.sectionLabels.filter((l): l is string => l !== null))].map((l) =>
      sanitizeText(l),
    ),
    columns,
    ...(groupKey !== undefined ? { groupKeyColumn: groupKey } : {}),
    monthColumns: columns.filter((c) => MONTH_HEADER.test(c.header.trim())).map((c) => c.index),
    sampleRows,
    headerConfidence: region.confidence,
  };
}

const ID_HEADER =
  /\b(order|invoice|receipt|po|transaction|txn|id|no|number|ref|reference|name|#)\b/i;

/**
 * The column that groups consecutive rows into one thing (the order number on line-level exports).
 * It must look like an identifier (not a date, money or quantity), repeat on consecutive rows for at
 * least 10% of rows, and each of its values must appear in exactly one unbroken run. Identifier-like
 * headers ("Order ID", "Invoice No") are preferred.
 */
function findGroupKey(sheet: RawSheet, region: Region, rows: number[]): number | undefined {
  if (rows.length < 10) return undefined;
  let best: { index: number; score: number } | undefined;
  for (const col of region.columns) {
    const values: string[] = [];
    let numeric = 0;
    let dates = 0;
    for (const r of rows) {
      const cell = sheet.rows[r]![col.index] ?? null;
      if (isEmptyCell(cell)) {
        values.push('');
        continue;
      }
      if (cell instanceof Date || parseDate(cell) !== undefined) dates += 1;
      else if (typeof cell === 'number' && !Number.isInteger(cell)) numeric += 1;
      else if (typeof cell === 'string' && parseNumber(cell)?.currency) numeric += 1;
      values.push(display(cell));
    }
    const filled = values.filter((v) => v !== '').length;
    if (filled < rows.length * 0.9 || dates > filled * 0.2 || numeric > filled * 0.2) continue;
    let repeats = 0;
    let runs = 0;
    const seen = new Set<string>();
    let contiguous = true;
    for (let i = 0; i < values.length; i++) {
      const v = values[i]!;
      if (v === '') continue;
      if (i > 0 && v === values[i - 1]) {
        repeats += 1;
        continue;
      }
      runs += 1;
      if (seen.has(v)) contiguous = false;
      seen.add(v);
    }
    if (!contiguous || repeats < rows.length * 0.1 || runs < Math.max(2, rows.length * 0.02))
      continue;
    const score = (ID_HEADER.test(col.header) ? 2 : 1) - col.index * 0.001;
    if (score > (best?.score ?? 0)) best = { index: col.index, score };
  }
  return best?.index;
}

/** Up to `n` values spread across the frequency-sorted list (common and rare values both appear). */
function spreadSample(values: string[], n: number): string[] {
  if (values.length <= n) return values;
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(values[Math.floor((i * values.length) / n)]!);
  return out;
}

function nearDuplicates(values: string[]): { key: string; variants: string[] }[] {
  const groups = new Map<string, Set<string>>();
  for (const v of values) {
    const key = normalizeKey(v);
    if (key.length < 2) continue;
    const set = groups.get(key) ?? new Set<string>();
    set.add(v.trim());
    groups.set(key, set);
  }
  return [...groups.entries()]
    .filter(([, set]) => set.size > 1)
    .slice(0, 50)
    .map(([key, set]) => ({ key, variants: [...set].map((v) => sanitizeText(v)) }));
}
