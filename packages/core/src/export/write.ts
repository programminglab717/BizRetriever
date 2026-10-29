import ExcelJS from 'exceljs';

import { shiftDecimal } from '../records/values';
import type { ColumnType, Sheet, SheetCell } from './sheet';

/**
 * CSV and Excel writers for downloads (ADR-056). Cell text comes from uploaded files, so it is
 * untrusted: in CSV, text that a spreadsheet would run as a formula is prefixed with `'`. Excel
 * files store text as text, so they need no guard.
 */

const FORMULA_START = /^[=+\-@\t\r]/;
const XLSX_TEXT_MAX = 32_767;

function csvText(v: string): string {
  const safe = FORMULA_START.test(v) ? `'${v}` : v;
  return /[",\r\n]|^\s|\s$/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** A number as plain digits ("0.0000001", not "1e-7"). */
function plain(v: string | number): string {
  if (typeof v === 'string') return v;
  return Number.isFinite(v) ? (Math.abs(v) < 1e-6 && v !== 0 ? v.toFixed(10) : String(v)) : '';
}

function csvCell(type: ColumnType, v: SheetCell): string {
  if (v === null || v === '') return '';
  switch (type) {
    case 'text':
      return csvText(String(v));
    case 'percent':
      // As a number of percent ("12.5"), the header says "(%)".
      return shiftDecimal(plain(v), 2);
    case 'datetime':
      return String(v).replace('T', ' ');
    case 'date':
      return String(v);
    default:
      return plain(v);
  }
}

/** UTF-8 CSV with a byte-order mark (so Excel reads accents), RFC 4180 quoting, CRLF lines. */
export function toCsv(sheet: Sheet): string {
  const header = sheet.columns.map((c) =>
    csvText(c.type === 'percent' ? `${c.label} (%)` : c.label),
  );
  const lines = [header.join(',')];
  for (const row of sheet.rows)
    lines.push(sheet.columns.map((c, i) => csvCell(c.type, row[i] ?? null)).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

const NUM_FMT: Partial<Record<ColumnType, string>> = {
  money: '#,##0.00',
  percent: '0.0%',
  date: 'yyyy-mm-dd',
  datetime: 'yyyy-mm-dd hh:mm',
};

/** Excel keeps dates as days; a UTC date at the wall-clock time reads back as that time. */
function xlsxCell(type: ColumnType, v: SheetCell): ExcelJS.CellValue {
  if (v === null || v === '') return null;
  switch (type) {
    case 'text':
      return String(v).slice(0, XLSX_TEXT_MAX);
    case 'date': {
      const d = new Date(`${String(v)}T00:00:00Z`);
      return Number.isNaN(d.getTime()) ? String(v) : d;
    }
    case 'datetime': {
      const d = new Date(`${String(v)}Z`);
      return Number.isNaN(d.getTime()) ? String(v) : d;
    }
    default: {
      // Excel stores every number as a double; money keeps its cents at any realistic size.
      const n = Number(v);
      return Number.isFinite(n) ? n : String(v);
    }
  }
}

const INVALID_SHEET = /[[\]:*?/\\]/g;

/** Excel's rules: up to 31 characters, none of []:*?/\, unique ignoring case. */
export function sheetNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const base =
      raw
        .replace(INVALID_SHEET, ' ')
        .replace(/^'+|'+$/g, '')
        .trim() || 'Sheet';
    let name = base.slice(0, 31);
    for (let n = 2; used.has(name.toLowerCase()) || name.toLowerCase() === 'history'; n += 1)
      name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

export interface AboutLine {
  label: string;
  value: string;
}

/**
 * An Excel workbook: one tab per sheet with a bold, frozen header and number formats, plus an
 * "About this file" tab (the question, dates, assumptions, what was left out).
 */
export async function toXlsx(
  sheets: readonly Sheet[],
  about: readonly AboutLine[] = [],
  /** "About this file", in the reader's language (M20). */
  aboutName = 'About this file',
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BizRetriever';
  wb.created = new Date();
  const names = sheetNames([...sheets.map((s) => s.name), ...(about.length ? [aboutName] : [])]);
  sheets.forEach((s, n) => {
    const ws = wb.addWorksheet(names[n] ?? s.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = s.columns.map((c, i) => {
      const longest = Math.max(
        c.label.length,
        ...s.rows.slice(0, 200).map((r) => String(r[i] ?? '').length),
      );
      const fmt = NUM_FMT[c.type];
      return {
        header: c.label,
        width: Math.min(50, Math.max(10, longest + 2)),
        ...(fmt ? { style: { numFmt: fmt } } : {}),
      };
    });
    ws.getRow(1).font = { bold: true };
    for (const r of s.rows) ws.addRow(s.columns.map((c, i) => xlsxCell(c.type, r[i] ?? null)));
  });
  if (about.length) {
    const ws = wb.addWorksheet(names.at(-1) ?? aboutName);
    ws.columns = [{ width: 18 }, { width: 90 }];
    for (const line of about) {
      const row = ws.addRow([line.label, line.value.slice(0, XLSX_TEXT_MAX)]);
      row.getCell(1).font = { bold: true };
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    }
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
