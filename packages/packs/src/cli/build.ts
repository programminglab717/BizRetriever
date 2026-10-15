/**
 * `pnpm packs:build` — validates every pack and writes `src/generated/packs.ts`, so the app can use
 * packs without reading YAML from disk at runtime (bundlers can't see those files).
 * `pnpm packs:validate` fails if the generated file is stale.
 */
import { writeFileSync } from 'node:fs';

import { GENERATED_FILE, renderGeneratedPacks } from '../bundle';
import { listPackDirs, loadPack } from '../loader';

const packs = listPackDirs().map((dir) => loadPack(dir));
writeFileSync(GENERATED_FILE, renderGeneratedPacks(packs));
console.log(`Wrote ${packs.length} pack(s) to src/generated/packs.ts`);
