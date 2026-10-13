import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { listPackDirs, loadPack, PackValidationError } from './loader';

function tempPack(folder: string, yaml: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'packs-'));
  const dir = path.join(root, folder);
  mkdirSync(dir);
  writeFileSync(path.join(dir, 'pack.yaml'), yaml);
  return dir;
}

describe('pack loader', () => {
  it('loads every shipped pack', () => {
    const dirs = listPackDirs();
    expect(dirs.map((d) => path.basename(d))).toContain('retail');
    for (const dir of dirs) expect(() => loadPack(dir)).not.toThrow();
  });

  it('reports every problem in an invalid manifest', () => {
    const dir = tempPack('bad', 'id: Bad-Id\nversion: one\n');
    try {
      loadPack(dir);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PackValidationError);
      const problems = (err as PackValidationError).problems.join('\n');
      expect(problems).toContain('pack.yaml id');
      expect(problems).toContain('pack.yaml version');
      expect(problems).toContain('pack.yaml name');
    }
  });

  it('requires the id to match the folder name', () => {
    const dir = tempPack(
      'other',
      [
        'id: retail',
        'version: 1.0.0',
        'name: X',
        'description: X',
        'industries_label: X',
        'locale_defaults: { currency: USD, date_order: MDY }',
        "requires_core: '>=0.1.0'",
        'primary_time_entity: sale',
      ].join('\n'),
    );
    expect(() => loadPack(dir)).toThrow(/must match its folder name/);
  });
});
