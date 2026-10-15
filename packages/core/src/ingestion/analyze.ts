import {
  detectRegions,
  parseFile,
  profileRegion,
  type DateOrder,
  type RawWorkbook,
} from '@bizr/ingest';

import type { ProfiledSource } from './heuristic';
import type { SourceTable } from './materialize';

export interface UploadedFile {
  fileName: string;
  bytes: Uint8Array;
  uploadId?: string;
}

export interface Analysis {
  workbooks: RawWorkbook[];
  tables: SourceTable[];
  profiled: ProfiledSource[];
}

/**
 * Parse → find tables → profile, for every sheet of every file. Source ids are stable:
 * `f<file>:<sheet>:<table>`, e.g. "f0:1:0" is the first table on the second sheet of the first file.
 */
export async function analyzeFiles(
  files: readonly UploadedFile[],
  options: { dateOrder: DateOrder; maskPii: boolean },
): Promise<Analysis> {
  const workbooks: RawWorkbook[] = [];
  const tables: SourceTable[] = [];
  const profiled: ProfiledSource[] = [];
  for (const [fi, file] of files.entries()) {
    const wb = await parseFile(file.bytes, file.fileName);
    workbooks.push(wb);
    wb.sheets.forEach((sheet, si) => {
      for (const [ri, region] of detectRegions(sheet, si).entries()) {
        const sourceId = `f${fi}:${si}:${ri}`;
        const table: SourceTable = { sourceId, fileName: file.fileName, sheet, region };
        if (file.uploadId) table.uploadId = file.uploadId;
        tables.push(table);
        profiled.push({
          sourceId,
          fileName: file.fileName,
          sheetName: sheet.name,
          profile: profileRegion(sheet, { ...region, id: sourceId }, options),
        });
      }
    });
  }
  return { workbooks, tables, profiled };
}
