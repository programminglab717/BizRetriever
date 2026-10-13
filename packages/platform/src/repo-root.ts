import { existsSync } from 'node:fs';
import path from 'node:path';

/** Walks up from `start` to the directory containing `pnpm-workspace.yaml`. */
export function findRepoRoot(start: string = process.cwd()): string {
  // turbopackIgnore: keep Next.js from tracing the whole repo because of this lookup.
  let dir = path.resolve(/* turbopackIgnore: true */ start);
  for (;;) {
    if (existsSync(path.join(/* turbopackIgnore: true */ dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Could not find repo root above ${start}`);
    dir = parent;
  }
}
