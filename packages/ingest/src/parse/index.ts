import { IngestError, type RawWorkbook } from '../grid';
import { parseCsv } from './csv';
import { parseXlsx } from './xlsx';

export { decodeText, parseCsv } from './csv';
export { parseXlsx } from './xlsx';

/** Parses an uploaded file by extension. Throws IngestError with a plain-language message. */
export async function parseFile(buffer: Uint8Array, fileName: string): Promise<RawWorkbook> {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'xlsx' || ext === 'xlsm' || ext === 'xls') return parseXlsx(buffer, fileName);
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return parseCsv(buffer, fileName);
  if (ext === 'pdf') {
    throw new IngestError(
      'unsupported_format',
      'We can’t read PDF files yet. Please export your data to Excel or CSV.',
    );
  }
  if (ext === 'numbers' || ext === 'ods') {
    throw new IngestError(
      'unsupported_format',
      'Please export this file as Excel (.xlsx) or CSV and upload that instead.',
    );
  }
  throw new IngestError(
    'unsupported_format',
    'We can read Excel (.xlsx) and CSV files. Please export your data in one of those formats.',
  );
}
