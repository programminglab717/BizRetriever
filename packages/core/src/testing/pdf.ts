import { inflateSync } from 'node:zlib';

/**
 * The text drawn in a PDFKit file, one string per text run, for tests (M15). Compressed streams
 * are inflated, so the file is read as it is sent.
 */
export function pdfText(bytes: Uint8Array): string[] {
  const raw = Buffer.from(bytes);
  const src = raw.toString('latin1');
  const parts: string[] = [];
  for (const m of src.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length;
    const end = src.indexOf('endstream', start);
    if (end < 0) continue;
    const body = raw.subarray(start, end);
    try {
      parts.push(inflateSync(body).toString('latin1'));
    } catch {
      parts.push(body.toString('latin1'));
    }
  }
  const out: string[] = [];
  for (const m of parts.join('\n').matchAll(/\[([^\]]*)\]\s*TJ/g))
    out.push(
      [...m[1]!.matchAll(/<([0-9a-fA-F]*)>/g)]
        .map((h) => Buffer.from(h[1]!, 'hex').toString('latin1'))
        .join(''),
    );
  return out;
}
