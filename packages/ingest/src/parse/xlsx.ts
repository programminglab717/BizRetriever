import ExcelJS from 'exceljs';

import {
  IngestError,
  LIMITS,
  type Cell,
  type CellRange,
  type RawSheet,
  type RawWorkbook,
} from '../grid';

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];

function startsWith(buffer: Uint8Array, magic: number[]): boolean {
  return magic.every((b, i) => buffer[i] === b);
}

/** Converts an ExcelJS cell value to our Cell (formulas → cached result, rich text → text). */
function toCell(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if ('result' in value) return toCell(value.result);
    if ('formula' in value || 'sharedFormula' in value) return null; // no cached value: never evaluate
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('error' in value) return null;
  }
  return null;
}

function parseRange(ref: string): CellRange | undefined {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return undefined;
  const col = (letters: string) =>
    [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return { top: Number(m[2]) - 1, left: col(m[1]!), bottom: Number(m[4]) - 1, right: col(m[3]!) };
}

export async function parseXlsx(buffer: Uint8Array, fileName: string): Promise<RawWorkbook> {
  if (startsWith(buffer, CFB_MAGIC)) {
    // Old .xls files and password-protected .xlsx files are both "compound" files.
    throw fileName.toLowerCase().endsWith('.xls')
      ? new IngestError(
          'legacy_xls',
          'This is an older Excel file (.xls). Please open it in Excel and save it as .xlsx, or export it as CSV.',
        )
      : new IngestError(
          'password_protected',
          'This file is password-protected. Remove the password and try again.',
        );
  }
  if (!startsWith(buffer, ZIP_MAGIC)) {
    throw new IngestError(
      'corrupt',
      'We couldn’t open this file. It may be damaged, or not really an Excel file.',
    );
  }

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (err) {
    throw new IngestError(
      'corrupt',
      'We couldn’t open this file. It may be damaged, or not really an Excel file.',
      err,
    );
  }
  if (wb.worksheets.length > LIMITS.maxSheets) {
    throw new IngestError(
      'too_large',
      `This file has more than ${LIMITS.maxSheets} sheets. Try splitting it into smaller files.`,
    );
  }

  const sheets: RawSheet[] = [];
  for (const ws of wb.worksheets) {
    if (ws.state === 'veryHidden') continue;
    const height = ws.rowCount;
    const width = ws.columnCount;
    if (height === 0 || width === 0) continue;
    if (height > LIMITS.maxRowsPerSheet) {
      throw new IngestError(
        'too_large',
        `The sheet “${ws.name}” has more than ${LIMITS.maxRowsPerSheet.toLocaleString('en-US')} rows. Try splitting it by year.`,
      );
    }
    if (width > LIMITS.maxColumns) {
      throw new IngestError(
        'too_large',
        `The sheet “${ws.name}” has more than ${LIMITS.maxColumns} columns.`,
      );
    }
    const rows: Cell[][] = [];
    for (let r = 1; r <= height; r++) {
      const row = ws.getRow(r);
      const cells: Cell[] = [];
      for (let c = 1; c <= width; c++) {
        const cell = row.getCell(c);
        // Merged cells: only the top-left ("master") cell keeps the value.
        cells.push(
          cell.isMerged && cell.master.address !== cell.address ? null : toCell(cell.value),
        );
      }
      rows.push(cells);
    }
    const merges = ((ws.model as { merges?: string[] }).merges ?? [])
      .map(parseRange)
      .filter((m): m is CellRange => m !== undefined);
    sheets.push({ name: ws.name, rows, width, merges });
  }
  if (sheets.length === 0) throw new IngestError('empty', 'This file looks empty.');
  return { fileName, kind: 'xlsx', sheets };
}
