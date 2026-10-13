/** `pnpm packs:validate` — validates every vertical pack. Runs in CI. */
import { listPackDirs, loadPack, PackValidationError } from '../loader';

let failed = false;
for (const dir of listPackDirs()) {
  try {
    const { manifest } = loadPack(dir);
    console.log(`✓ ${manifest.id}@${manifest.version} (${manifest.name})`);
  } catch (err) {
    failed = true;
    console.error(err instanceof PackValidationError ? err.message : err);
  }
}
process.exit(failed ? 1 : 0);
