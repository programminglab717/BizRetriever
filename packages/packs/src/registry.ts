import { BUNDLED_PACKS } from './generated/packs';
import type { PackData } from './types';

/** A shipped pack by id (from the generated bundle; no file access at runtime). */
export function getPack(id: string): PackData {
  const pack = BUNDLED_PACKS[id];
  if (!pack) throw new Error(`Unknown pack "${id}"`);
  return pack;
}

export function listPacks(): PackData[] {
  return Object.values(BUNDLED_PACKS);
}
