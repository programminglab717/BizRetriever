import { asc, inArray } from 'drizzle-orm';

import { getAppDb } from '../client';
import { upload } from '../schema/ingestion';
import { sha256Hex, StorageNotFoundError, type Storage } from './index';

/**
 * Moving uploaded originals to another driver (M17, ADR-067), e.g. from the free preview's Postgres
 * to R2 before switching STORAGE_DRIVER. Copies every file the uploads point to, checks each one
 * by its fingerprint after writing, and never deletes anything from the source. Safe to run again:
 * files already there are only checked.
 */

export interface MoveSummary {
  files: number;
  copied: number;
  /** Already in the destination (checked). */
  present: number;
  /** In no store at all: listed for a person to look at. */
  missing: string[];
  /** Bytes that don't match their fingerprint. */
  damaged: string[];
}

export async function moveStoredFiles(
  from: Storage,
  to: Storage,
  options: {
    dryRun?: boolean;
    /** Only these businesses (default: all). */
    workspaceIds?: string[];
    onFile?: (key: string, done: number, total: number) => void;
  } = {},
): Promise<MoveSummary> {
  const rows = await getAppDb()
    .selectDistinct({ key: upload.storageKey, workspaceId: upload.workspaceId })
    .from(upload)
    .where(options.workspaceIds ? inArray(upload.workspaceId, options.workspaceIds) : undefined)
    .orderBy(asc(upload.storageKey));
  const summary: MoveSummary = {
    files: rows.length,
    copied: 0,
    present: 0,
    missing: [],
    damaged: [],
  };
  const fingerprint = (key: string) => key.split('/').at(-1);
  let done = 0;
  for (const { key, workspaceId } of rows) {
    done += 1;
    options.onFile?.(key, done, rows.length);
    if (await to.exists(key)) {
      if (!options.dryRun && sha256Hex(await to.get(key)) !== fingerprint(key))
        summary.damaged.push(key);
      else summary.present += 1;
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = await from.get(key);
    } catch (err) {
      if (err instanceof StorageNotFoundError) {
        summary.missing.push(key);
        continue;
      }
      throw err;
    }
    if (sha256Hex(bytes) !== fingerprint(key)) {
      summary.damaged.push(key);
      continue;
    }
    if (options.dryRun) {
      summary.copied += 1;
      continue;
    }
    await to.put(key, bytes, workspaceId);
    if (sha256Hex(await to.get(key)) !== fingerprint(key)) summary.damaged.push(key);
    else summary.copied += 1;
  }
  return summary;
}
