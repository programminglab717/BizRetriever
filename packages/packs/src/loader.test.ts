import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { listPackDirs, loadPack, PackValidationError } from './loader';
import { getPack } from './registry';

const ENTITIES = [
  'entities:',
  '  - id: sale',
  '    label: { singular: Sale, plural: Sales }',
  '    description: A sale.',
  '    fields: [{ id: sale_date, label: Date, type: date }]',
].join('\n');

function tempPack(folder: string, yaml: string, entities = ENTITIES): string {
  const root = mkdtempSync(path.join(tmpdir(), 'packs-'));
  const dir = path.join(root, folder);
  mkdirSync(path.join(dir, 'prompts'), { recursive: true });
  writeFileSync(path.join(dir, 'pack.yaml'), yaml);
  writeFileSync(path.join(dir, 'entities.yaml'), entities);
  writeFileSync(path.join(dir, 'synonyms.yaml'), 'fields:\n  sale.sale_date: [date]\n');
  writeFileSync(path.join(dir, 'patterns.yaml'), 'known_formats: []\n');
  writeFileSync(path.join(dir, 'prompts', 'domain_primer.md'), 'Primer.');
  return dir;
}

describe('pack loader', () => {
  it('loads every shipped pack', () => {
    const dirs = listPackDirs();
    expect(dirs.map((d) => path.basename(d))).toContain('retail');
    for (const dir of dirs) expect(() => loadPack(dir)).not.toThrow();
  });

  it('loads the full retail entity catalog', () => {
    const retail = loadPack(listPackDirs().find((d) => d.endsWith('retail'))!);
    expect(retail.entities.map((e) => e.id)).toEqual([
      'product',
      'customer',
      'supplier',
      'location',
      'sale',
      'sale_line',
      'return',
      'purchase',
      'purchase_line',
      'stock_count',
      'stock_movement',
      'expense',
      'payment',
    ]);
  });

  it('reports problems in entities.yaml', () => {
    const dir = tempPack(
      'retail',
      VALID_MANIFEST,
      'entities:\n  - id: sale\n    label: { singular: Sale, plural: Sales }\n    description: x\n    fields: [{ id: customer, label: C, type: reference, references: customer }]\n',
    );
    expect(() => loadPack(dir)).toThrow(/unknown entity "customer"/);
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
    const dir = tempPack('other', VALID_MANIFEST);
    expect(() => loadPack(dir)).toThrow(/must match its folder name/);
  });
});

const VALID_MANIFEST = [
  'id: retail',
  'version: 1.0.0',
  'name: X',
  'description: X',
  'industries_label: X',
  'locale_defaults: { currency: USD, date_order: MDY }',
  "requires_core: '>=0.1.0'",
  'primary_time_entity: sale',
].join('\n');

describe('bundled packs', () => {
  it('match the YAML on disk', () => {
    const retail = loadPack(listPackDirs().find((d) => d.endsWith('retail'))!);
    expect(getPack('retail')).toEqual({
      manifest: retail.manifest,
      entities: retail.entities,
      synonyms: retail.synonyms,
      knownFormats: retail.knownFormats,
      metrics: retail.metrics,
      questions: retail.questions,
      primer: retail.primer,
    });
  });

  it('throw for unknown packs', () => {
    expect(() => getPack('nope')).toThrow(/Unknown pack/);
  });
});
