import iconv from 'iconv-lite';
import jschardet from 'jschardet';
import Papa from 'papaparse';

import { IngestError, LIMITS, type Cell, type RawWorkbook } from '../grid';

/** Decodes bytes to text: BOM first, then strict UTF-8, then charset detection (default Windows-1252). */
export function decodeText(buffer: Uint8Array): { text: string; encoding: string } {
  const bytes = Buffer.from(buffer);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: bytes.subarray(3).toString('utf8'), encoding: 'utf-8' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return { text: iconv.decode(bytes.subarray(2), 'utf16le'), encoding: 'utf-16le' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return { text: iconv.decode(bytes.subarray(2), 'utf16be'), encoding: 'utf-16be' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    const guess = jschardet.detect(bytes.subarray(0, 64 * 1024).toString('binary'));
    const name =
      guess.encoding && iconv.encodingExists(guess.encoding) && guess.confidence > 0.5
        ? guess.encoding.toLowerCase()
        : 'windows-1252';
    // Single-byte guesses for Western text are almost always really Windows-1252.
    const encoding = ['ascii', 'iso-8859-1', 'iso-8859-2', 'iso-8859-15'].includes(name)
      ? 'windows-1252'
      : name;
    return { text: iconv.decode(bytes, encoding), encoding };
  }
}

export function parseCsv(buffer: Uint8Array, fileName: string): RawWorkbook {
  const { text, encoding } = decodeText(buffer);
  if (text.includes('\u0000')) {
    throw new IngestError('unsupported_format', 'This doesn’t look like a text or CSV file.');
  }
  const parsed = Papa.parse<string[]>(text, { delimiter: '', skipEmptyLines: false });
  const raw = parsed.data;
  // Papa returns a trailing [""] for the final newline.
  while (raw.length > 0 && raw[raw.length - 1]!.every((c) => c === '')) raw.pop();
  if (raw.length === 0) throw new IngestError('empty', 'This file looks empty.');
  if (raw.length > LIMITS.maxRowsPerSheet) {
    throw new IngestError(
      'too_large',
      `This file has more than ${LIMITS.maxRowsPerSheet.toLocaleString('en-US')} rows. Try splitting it by year.`,
    );
  }
  const width = Math.max(...raw.map((r) => r.length));
  if (width > LIMITS.maxColumns)
    throw new IngestError('too_large', `This file has more than ${LIMITS.maxColumns} columns.`);
  const rows: Cell[][] = raw.map((r) => {
    const cells: Cell[] = r.map((v) => (v === '' ? null : v));
    while (cells.length < width) cells.push(null);
    return cells;
  });
  return { fileName, kind: 'csv', encoding, sheets: [{ name: fileName, rows, width, merges: [] }] };
}
