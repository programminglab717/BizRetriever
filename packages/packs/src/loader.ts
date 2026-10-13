import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { packManifestSchema, type PackManifest } from './schema';

export const PACKS_DIR = fileURLToPath(new URL('../packs', import.meta.url));

export interface LoadedPack {
  dir: string;
  manifest: PackManifest;
}

export class PackValidationError extends Error {
  constructor(
    readonly packDir: string,
    readonly problems: string[],
  ) {
    super(`Invalid pack at ${packDir}:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
}

/** Loads and validates one pack directory. Throws PackValidationError listing every problem. */
export function loadPack(dir: string): LoadedPack {
  const raw: unknown = parse(readFileSync(path.join(dir, 'pack.yaml'), 'utf8'));
  const result = packManifestSchema.safeParse(raw);
  if (!result.success) {
    throw new PackValidationError(
      dir,
      result.error.issues.map((i) => `pack.yaml ${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  if (result.data.id !== path.basename(dir)) {
    throw new PackValidationError(dir, [`pack id "${result.data.id}" must match its folder name`]);
  }
  return { dir, manifest: result.data };
}

/** Every pack shipped in this repo (folders starting with `_` are templates). */
export function listPackDirs(root: string = PACKS_DIR): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => path.join(root, d.name))
    .sort();
}
