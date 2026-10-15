import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import {
  checkEntityReferences,
  checkSynonyms,
  packEntitiesFileSchema,
  packManifestSchema,
  packPatternsFileSchema,
  packSynonymsFileSchema,
  type KnownFormat,
  type PackEntity,
  type PackManifest,
  type PackSynonyms,
} from './schema';

export const PACKS_DIR = fileURLToPath(new URL('../packs', import.meta.url));

export interface LoadedPack {
  dir: string;
  manifest: PackManifest;
  entities: PackEntity[];
  synonyms: PackSynonyms;
  knownFormats: KnownFormat[];
  primer: string;
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
  const problems: string[] = [];
  const read = (file: string): unknown => {
    try {
      return parse(readFileSync(path.join(dir, file), 'utf8'));
    } catch (err) {
      problems.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  };
  const issues = (file: string, error: { issues: { path: PropertyKey[]; message: string }[] }) =>
    error.issues.map((i) => `${file} ${i.path.map(String).join('.') || '(root)'}: ${i.message}`);

  const manifest = packManifestSchema.safeParse(read('pack.yaml'));
  if (!manifest.success) problems.push(...issues('pack.yaml', manifest.error));
  const entities = packEntitiesFileSchema.safeParse(read('entities.yaml'));
  if (!entities.success) problems.push(...issues('entities.yaml', entities.error));
  const synonyms = packSynonymsFileSchema.safeParse(read('synonyms.yaml'));
  if (!synonyms.success) problems.push(...issues('synonyms.yaml', synonyms.error));
  const patterns = packPatternsFileSchema.safeParse(read('patterns.yaml'));
  if (!patterns.success) problems.push(...issues('patterns.yaml', patterns.error));
  let primer = '';
  try {
    primer = readFileSync(path.join(dir, 'prompts', 'domain_primer.md'), 'utf8').trim();
  } catch {
    problems.push('prompts/domain_primer.md is missing');
  }

  if (manifest.success && manifest.data.id !== path.basename(dir)) {
    problems.push(`pack id "${manifest.data.id}" must match its folder name`);
  }
  if (entities.success) {
    problems.push(
      ...checkEntityReferences(entities.data.entities).map((p) => `entities.yaml: ${p}`),
    );
    if (
      manifest.success &&
      !entities.data.entities.some((e) => e.id === manifest.data.primary_time_entity)
    ) {
      problems.push(
        `pack.yaml primary_time_entity "${manifest.data.primary_time_entity}" is not an entity`,
      );
    }
  }

  if (entities.success && synonyms.success) {
    problems.push(
      ...checkSynonyms(entities.data.entities, synonyms.data).map((p) => `synonyms.yaml: ${p}`),
    );
  }

  if (
    problems.length > 0 ||
    !manifest.success ||
    !entities.success ||
    !synonyms.success ||
    !patterns.success
  ) {
    throw new PackValidationError(dir, problems);
  }
  return {
    dir,
    manifest: manifest.data,
    entities: entities.data.entities,
    synonyms: synonyms.data,
    knownFormats: patterns.data.known_formats,
    primer,
  };
}

/** Every pack shipped in this repo (folders starting with `_` are templates). */
export function listPackDirs(root: string = PACKS_DIR): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => path.join(root, d.name))
    .sort();
}
