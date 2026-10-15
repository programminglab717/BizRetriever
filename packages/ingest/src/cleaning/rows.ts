import { cellText, isEmptyCell, type Cell, type RawSheet } from '../grid';
import type { Region, RowKind } from '../regions';
import { isNullSentinel } from '../values/text';
import type { ColumnRef, RowRule, VirtualColumn } from './rules';

/** One record from a source sheet, before mapping to an entity. */
export interface SourceRecord {
  /** 1-based sheet row, as the user sees it in Excel (for "where did this come from?"). */
  sheetRow: number;
  /** For unpivoted records: the column the value came from (0-based). */
  sourceColumn?: number;
  cells: Cell[];
  virtual: Partial<Record<VirtualColumn, Cell>>;
}

export type SkipReason = Exclude<RowKind, 'data'> | 'rule';

export interface SkippedRow {
  sheetRow: number;
  reason: SkipReason;
  /** Plain-language detail, e.g. the rule's reason or the row's text (sanitised later). */
  detail: string;
}

export function readColumn(record: SourceRecord, ref: ColumnRef): Cell {
  return typeof ref === 'number' ? (record.cells[ref] ?? null) : (record.virtual[ref] ?? null);
}

function rowText(cells: Cell[]): string {
  return cells
    .filter((c) => !isEmptyCell(c))
    .map((c) => cellText(c))
    .join(' · ')
    .slice(0, 120);
}

/**
 * Applies row rules to a region: data rows become records (with `section` and `sheet_name` virtual
 * columns), every other row is reported as skipped with a reason. Rules always run in a fixed order:
 * skip → fill down → unpivot.
 */
export function buildRecords(
  sheet: RawSheet,
  region: Region,
  rules: readonly RowRule[],
): { records: SourceRecord[]; skipped: SkippedRow[] } {
  const skipped: SkippedRow[] = [];
  let records: SourceRecord[] = [];

  region.rowKinds.forEach((kind, i) => {
    const r = region.firstRow + i;
    const cells = sheet.rows[r]!;
    if (kind !== 'data') {
      skipped.push({ sheetRow: r + 1, reason: kind, detail: rowText(cells) });
      return;
    }
    records.push({
      sheetRow: r + 1,
      cells: [...cells],
      virtual: { section: region.sectionLabels[i] ?? null, sheet_name: sheet.name },
    });
  });

  // 1. Skip rules.
  for (const rule of rules) {
    if (rule.rule !== 'skip_rows') continue;
    const rowSet = new Set(rule.rows ?? []);
    records = records.filter((rec) => {
      let skip = rowSet.has(rec.sheetRow);
      if (!skip && rule.where) {
        const value = readColumn(rec, rule.where.column);
        const text = isEmptyCell(value) ? '' : cellText(value).trim().toLowerCase();
        if (rule.where.isEmpty !== undefined) skip = (text === '') === rule.where.isEmpty;
        if (rule.where.equals)
          skip ||= rule.where.equals.some((e) => e.trim().toLowerCase() === text);
        if (rule.where.startsWith)
          skip ||= rule.where.startsWith.some((p) => text.startsWith(p.trim().toLowerCase()));
      }
      if (skip) skipped.push({ sheetRow: rec.sheetRow, reason: 'rule', detail: rule.reason });
      return !skip;
    });
  }

  // 2. Fill down (blank cells take the value above, optionally only within the same group).
  for (const rule of rules) {
    if (rule.rule !== 'fill_down') continue;
    for (let i = 1; i < records.length; i++) {
      const rec = records[i]!;
      const prev = records[i - 1]!;
      if (rule.withinGroup !== undefined) {
        const a = readColumn(rec, rule.withinGroup);
        const b = readColumn(prev, rule.withinGroup);
        if (isEmptyCell(a) || cellText(a) !== cellText(b)) continue;
      }
      for (const col of rule.columns) {
        if (!isEmptyCell(readColumn(rec, col))) continue;
        const above = readColumn(prev, col);
        if (typeof col === 'number') rec.cells[col] = above;
        else rec.virtual[col] = above;
      }
    }
  }

  // 3. Unpivot (wide → long): one record per non-empty cell in the listed columns.
  const unpivot = rules.find(
    (r): r is Extract<RowRule, { rule: 'unpivot' }> => r.rule === 'unpivot',
  );
  if (unpivot) {
    const headers = new Map(region.columns.map((c) => [c.index, c.header]));
    const long: SourceRecord[] = [];
    for (const rec of records) {
      for (const col of unpivot.columns) {
        const value = rec.cells[col] ?? null;
        if (isEmptyCell(value) || (typeof value === 'string' && isNullSentinel(value))) continue;
        long.push({
          sheetRow: rec.sheetRow,
          sourceColumn: col,
          cells: rec.cells,
          virtual: { ...rec.virtual, unpivot_key: headers.get(col) ?? null, unpivot_value: value },
        });
      }
    }
    records = long;
  }

  return { records, skipped: skipped.sort((a, b) => a.sheetRow - b.sheetRow) };
}
