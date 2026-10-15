import { cellText, isEmptyCell, type Cell, type RawSheet } from './grid';
import { parseDate } from './values/dates';
import { parseNumber } from './values/numbers';

/**
 * Finds the real table(s) in a sheet and classifies every row (ARCHITECTURE §2, VERTICAL_PACKS §2.3):
 * title rows above the header, one- or two-row headers, category section rows ("CANDLES"), totals,
 * notes ("DISCONTINUED - do not reorder"), blank rows and repeated headers. Deterministic heuristics;
 * the AI can override them later, and the user sees every skipped row.
 */

export type RowKind = 'data' | 'blank' | 'title' | 'header' | 'totals' | 'note' | 'section';

export interface RegionColumn {
  index: number;
  /** Header text (combined for two-row headers); "Column D" when the header cell is empty. */
  header: string;
}

export interface Region {
  /** Stable id within the workbook: `<sheet index>:<region index>`. */
  id: string;
  sheetIndex: number;
  sheetName: string;
  headerRows: number[];
  columns: RegionColumn[];
  /** First and last row index (0-based, inclusive) covered by this region, including titles. */
  firstRow: number;
  lastRow: number;
  /** Kind of every row in [firstRow, lastRow]. */
  rowKinds: RowKind[];
  /** Section label in force for each data row (from the last section row above it), if any. */
  sectionLabels: (string | null)[];
  /** 0–1: how sure we are about the header. */
  confidence: number;
}

interface RowInfo {
  nonEmpty: number;
  strings: number;
  numbers: number;
  dates: number;
  firstCol: number;
  texts: string[];
}

const TOTALS = /^(grand\s+|sub-?\s*)?totals?\b|^sum\b|^balance\s+carried/i;

function looksNumeric(cell: Cell): boolean {
  return typeof cell === 'number' || (typeof cell === 'string' && parseNumber(cell) !== undefined);
}

function looksDate(cell: Cell): boolean {
  return cell instanceof Date || (typeof cell === 'string' && parseDate(cell) !== undefined);
}

function rowInfo(row: Cell[]): RowInfo {
  const info: RowInfo = { nonEmpty: 0, strings: 0, numbers: 0, dates: 0, firstCol: -1, texts: [] };
  row.forEach((cell, c) => {
    if (isEmptyCell(cell)) return;
    info.nonEmpty += 1;
    if (info.firstCol < 0) info.firstCol = c;
    if (looksDate(cell)) info.dates += 1;
    else if (looksNumeric(cell)) info.numbers += 1;
    else if (typeof cell === 'string') {
      info.strings += 1;
      info.texts.push(cell.trim());
    }
  });
  return info;
}

const columnLetter = (index: number): string => {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const normalizeHeader = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** How header-like row `r` is, given the rows that follow it (0–1). */
function headerScore(rows: Cell[][], infos: RowInfo[], r: number): number {
  const info = infos[r]!;
  if (info.nonEmpty < 2) return 0;
  const stringShare = info.strings / info.nonEmpty;
  if (stringShare < 0.75) return 0;
  const longTexts = info.texts.filter((t) => t.length > 45).length;
  if (longTexts > info.nonEmpty / 3) return 0;
  const distinct = new Set(info.texts.map(normalizeHeader)).size;
  if (distinct < info.texts.length * 0.8) return 0;

  // Look at the next few non-blank rows: they should be filled in under the header's columns.
  const below: number[] = [];
  for (let i = r + 1; i < rows.length && below.length < 8; i++)
    if (infos[i]!.nonEmpty > 0) below.push(i);
  if (below.length === 0) return 0.2;
  const headerCols = rows[r]!.map((c, i) => (isEmptyCell(c) ? -1 : i)).filter((i) => i >= 0);
  let support = 0;
  let typedBelow = 0;
  for (const b of below) {
    const filled = headerCols.filter((c) => !isEmptyCell(rows[b]![c] ?? null)).length;
    support += filled / headerCols.length;
    typedBelow += infos[b]!.numbers + infos[b]!.dates > 0 ? 1 : 0;
  }
  const coverage = support / below.length;
  const typed = typedBelow / below.length;
  const width = Math.min(1, info.nonEmpty / Math.max(...below.map((b) => infos[b]!.nonEmpty)));
  return Math.min(1, 0.45 * coverage + 0.35 * typed + 0.2 * width + (stringShare === 1 ? 0.05 : 0));
}

function classifySingleCell(text: string, nextIsData: boolean): 'section' | 'note' {
  const words = text.split(/\s+/).filter(Boolean);
  const letters = text.replace(/[^A-Za-z]/g, '');
  const allCaps = letters.length > 0 && letters === letters.toUpperCase();
  if (/[.!?:]$/.test(text) || text.length > 40) return 'note';
  if (allCaps && !/\s-\s/.test(text)) return 'section';
  if (
    nextIsData &&
    words.length <= 3 &&
    /^[A-Z]/.test(text) &&
    !/\b(do|not|no|see|note|please)\b/i.test(text)
  ) {
    return 'section';
  }
  return 'note';
}

export function detectRegions(sheet: RawSheet, sheetIndex: number): Region[] {
  const { rows } = sheet;
  const infos = rows.map(rowInfo);
  const regions: Region[] = [];
  let cursor = 0;

  while (cursor < rows.length) {
    // Skip leading blanks.
    while (cursor < rows.length && infos[cursor]!.nonEmpty === 0) cursor += 1;
    if (cursor >= rows.length) break;

    // Find the header within the next 30 non-blank rows.
    let headerRow = -1;
    let best = 0;
    for (let r = cursor, seen = 0; r < rows.length && seen < 30; r++) {
      if (infos[r]!.nonEmpty === 0) continue;
      seen += 1;
      const score = headerScore(rows, infos, r);
      if (score >= 0.6) {
        headerRow = r;
        best = score;
        break;
      }
      if (score > best) {
        best = score;
        headerRow = r;
      }
    }
    if (headerRow < 0) {
      headerRow = cursor;
      best = 0.1;
    }
    // A sparse group row ("Price", "Stock") can score well on its own; if the next row is a wider,
    // all-text, header-like row, that is the real header (the group row becomes its top half).
    {
      let next = headerRow + 1;
      while (next < rows.length && infos[next]!.nonEmpty === 0) next += 1;
      const n = infos[next];
      if (
        n &&
        next === headerRow + 1 &&
        n.strings === n.nonEmpty &&
        n.nonEmpty > infos[headerRow]!.nonEmpty
      ) {
        const nextScore = headerScore(rows, infos, next);
        if (nextScore >= 0.6) {
          headerRow = next;
          best = nextScore;
        }
      }
    }

    // Two-row header: a row just above with grouping labels (often merged across a few columns).
    const headerRows = [headerRow];
    const above = headerRow - 1;
    if (above >= cursor && infos[above]!.nonEmpty > 0) {
      const info = infos[above]!;
      const merged = sheet.merges.filter((m) => m.top === above && m.right > m.left);
      const spansAll = merged.some((m) => m.right - m.left + 1 >= sheet.width * 0.7);
      const groupLike =
        info.strings === info.nonEmpty &&
        info.texts.every((t) => t.length <= 30) &&
        info.nonEmpty < infos[headerRow]!.nonEmpty &&
        !spansAll &&
        (merged.length > 0 || info.nonEmpty >= 2);
      if (groupLike) headerRows.unshift(above);
    }

    // Region ends before a new header-like row that follows 2+ blank rows.
    let lastRow = rows.length - 1;
    let blankRun = 0;
    for (let r = headerRow + 1; r < rows.length; r++) {
      if (infos[r]!.nonEmpty === 0) {
        blankRun += 1;
        continue;
      }
      if (blankRun >= 2 && headerScore(rows, infos, r) >= 0.75) {
        lastRow = r - 1;
        break;
      }
      blankRun = 0;
    }

    // Column headers (combining two-row headers).
    const usedCols: number[] = [];
    for (let c = 0; c < sheet.width; c++) {
      let used = headerRows.some((h) => !isEmptyCell(rows[h]![c] ?? null));
      for (let r = headerRow + 1; !used && r <= lastRow; r++)
        used = !isEmptyCell(rows[r]![c] ?? null);
      if (used) usedCols.push(c);
    }
    const parentOf = (row: number, c: number): string => {
      const m = sheet.merges.find(
        (x) => x.top <= row && x.bottom >= row && x.left <= c && x.right >= c,
      );
      return cellText(rows[row]![m ? m.left : c] ?? null).trim();
    };
    const columns: RegionColumn[] = usedCols.map((c) => {
      const parts = headerRows.map((h) => parentOf(h, c)).filter((t) => t !== '');
      const header = [...new Set(parts)].join(' ').replace(/\s+/g, ' ').trim();
      return { index: c, header: header || `Column ${columnLetter(c)}` };
    });
    const headerKeys = new Set(columns.map((c) => normalizeHeader(c.header)));

    // Classify rows.
    const firstRow = cursor;
    const rowKinds: RowKind[] = [];
    const sectionLabels: (string | null)[] = [];
    let section: string | null = null;
    const typicalWidth = (() => {
      const counts = [];
      for (let r = headerRow + 1; r <= lastRow; r++)
        if (infos[r]!.nonEmpty > 0) counts.push(infos[r]!.nonEmpty);
      counts.sort((a, b) => a - b);
      return counts[Math.floor(counts.length / 2)] ?? 0;
    })();
    for (let r = firstRow; r <= lastRow; r++) {
      const info = infos[r]!;
      let kind: RowKind;
      if (r < headerRows[0]!) kind = info.nonEmpty === 0 ? 'blank' : 'title';
      else if (headerRows.includes(r)) kind = 'header';
      else if (info.nonEmpty === 0) kind = 'blank';
      else if (info.texts.slice(0, 3).some((t) => TOTALS.test(t))) kind = 'totals';
      else if (
        info.strings >= 2 &&
        info.texts.filter((t) => headerKeys.has(normalizeHeader(t))).length >=
          Math.max(2, columns.length * 0.7)
      ) {
        kind = 'header'; // the header repeated mid-sheet
      } else if (info.nonEmpty === 1 && info.strings === 1 && typicalWidth >= 3) {
        let next = r + 1;
        while (next <= lastRow && infos[next]!.nonEmpty === 0) next += 1;
        const nextIsData = next <= lastRow && infos[next]!.nonEmpty >= 2;
        kind = classifySingleCell(info.texts[0]!, nextIsData);
      } else kind = 'data';

      if (kind === 'section') section = info.texts[0]!;
      rowKinds.push(kind);
      sectionLabels.push(kind === 'data' ? section : null);
    }

    regions.push({
      id: `${sheetIndex}:${regions.length}`,
      sheetIndex,
      sheetName: sheet.name,
      headerRows,
      columns,
      firstRow,
      lastRow,
      rowKinds,
      sectionLabels,
      confidence: Math.round(best * 100) / 100,
    });
    cursor = lastRow + 1;
  }
  return regions;
}

/** Row indices (0-based, in the sheet) of a region's data rows. */
export function dataRowIndices(region: Region): number[] {
  const out: number[] = [];
  region.rowKinds.forEach((k, i) => {
    if (k === 'data') out.push(region.firstRow + i);
  });
  return out;
}

export function countRowKinds(region: Region): Record<RowKind, number> {
  const counts: Record<RowKind, number> = {
    data: 0,
    blank: 0,
    title: 0,
    header: 0,
    totals: 0,
    note: 0,
    section: 0,
  };
  for (const k of region.rowKinds) counts[k] += 1;
  return counts;
}
