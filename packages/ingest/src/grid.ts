/** A spreadsheet cell after parsing: formulas resolved to their cached value, rich text flattened. */
export type Cell = string | number | boolean | Date | null;

/** 0-based, inclusive. */
export interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface RawSheet {
  /** Sheet name (for CSV: the file name). Untrusted text. */
  name: string;
  /** Rows of cells, 0-based; every row has `width` cells. */
  rows: Cell[][];
  width: number;
  merges: CellRange[];
}

export interface RawWorkbook {
  fileName: string;
  kind: 'xlsx' | 'csv';
  /** For CSV: the detected text encoding. */
  encoding?: string;
  sheets: RawSheet[];
}

export const LIMITS = {
  maxSheets: 20,
  maxRowsPerSheet: 200_000,
  maxColumns: 200,
} as const;

export type IngestErrorCode =
  'unsupported_format' | 'legacy_xls' | 'password_protected' | 'empty' | 'too_large' | 'corrupt';

/** A problem with a file that we explain to the user in plain language. */
export class IngestError extends Error {
  constructor(
    readonly code: IngestErrorCode,
    readonly userMessage: string,
    cause?: unknown,
  ) {
    super(`${code}: ${userMessage}`, { cause });
  }
}

export function isEmptyCell(cell: Cell): boolean {
  return cell === null || (typeof cell === 'string' && cell.trim() === '');
}

export function cellText(cell: Cell): string {
  if (cell === null) return '';
  if (cell instanceof Date) return cell.toISOString();
  return String(cell);
}
