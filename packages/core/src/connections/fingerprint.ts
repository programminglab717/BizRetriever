import { createHash } from 'node:crypto';

import { parseFile } from '@bizr/ingest';

/**
 * What a fetched source contains, as a hash of its sheets' cell values (not the file bytes: an
 * exported workbook's bytes change every time, its contents don't). Same fingerprint, nothing new.
 */
export async function contentFingerprint(
  files: readonly { fileName: string; bytes: Uint8Array }[],
): Promise<string> {
  const hash = createHash('sha256');
  for (const f of [...files].sort((a, b) => a.fileName.localeCompare(b.fileName))) {
    hash.update(`file:${f.fileName}\n`);
    try {
      const wb = await parseFile(f.bytes, f.fileName);
      hash.update(JSON.stringify(wb.sheets));
    } catch {
      hash.update(createHash('sha256').update(f.bytes).digest('hex'));
    }
  }
  return hash.digest('hex');
}
