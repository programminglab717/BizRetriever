/** `pnpm packs:validate` — validates every vertical pack. Runs in CI. */
import { readFileSync } from 'node:fs';

import {
  GENERATED_FILE,
  PACK_CATALOG_FILE,
  renderGeneratedPacks,
  renderPackCatalog,
} from '../bundle';
import { listPackDirs, loadPack, PackValidationError, type LoadedPack } from '../loader';

let failed = false;
const loaded: LoadedPack[] = [];
for (const dir of listPackDirs()) {
  try {
    const pack = loadPack(dir);
    loaded.push(pack);
    const { manifest, entities } = pack;
    const fields = entities.reduce((n, e) => n + e.fields.length, 0);
    console.log(
      `✓ ${manifest.id}@${manifest.version} (${manifest.name}): ${entities.length} entities, ${fields} fields, ${pack.metrics.metrics.length} metrics`,
    );
  } catch (err) {
    failed = true;
    console.error(err instanceof PackValidationError ? err.message : err);
  }
}
if (!failed && readFileSync(GENERATED_FILE, 'utf8') !== renderGeneratedPacks(loaded)) {
  failed = true;
  console.error(
    'src/generated/packs.ts is out of date. Run `pnpm packs:build` and commit the result.',
  );
}
if (!failed && readFileSync(PACK_CATALOG_FILE, 'utf8') !== renderPackCatalog(loaded)) {
  failed = true;
  console.error(
    'packages/i18n/src/es/packs.ts is out of date. Run `pnpm packs:build` and commit the result.',
  );
}
process.exit(failed ? 1 : 0);
