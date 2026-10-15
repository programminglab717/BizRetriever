import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { generateDemoDataset, type GroundTruth } from '@bizr/demo-data';
import { beforeAll, describe, expect, it } from 'vitest';

import type { RawWorkbook } from './grid';
import { parseFile } from './parse';
import { profileRegion } from './profile';
import { countRowKinds, detectRegions } from './regions';

let truth: GroundTruth;
const workbooks = new Map<string, RawWorkbook>();

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fernwood-ingest-'));
  truth = await generateDemoDataset({ today: '2026-10-13', seed: 42, outDir: dir });
  for (const file of readdirSync(dir).filter((f) => f !== 'ground_truth.json')) {
    workbooks.set(file, await parseFile(readFileSync(path.join(dir, file)), file));
  }
}, 60_000);

describe('the demo files', () => {
  it('parse, including the Windows-1252 till export', () => {
    expect([...workbooks.keys()].sort()).toEqual(
      [...new Set(truth.files.map((f) => f.file))].sort(),
    );
    const till = workbooks.get('Shop till export.csv')!;
    expect(till.encoding).toBe('windows-1252');
    const text = till.sheets[0]!.rows.flat()
      .filter((c) => typeof c === 'string')
      .join(' ');
    expect(text).toContain('Speckled Café Mug');
  });

  it('give the region detector exactly the data rows, titles, totals, sections and notes we planted', () => {
    for (const report of truth.files) {
      const wb = workbooks.get(report.file)!;
      const sheetIndex = wb.sheets.findIndex((s) => s.name === report.sheet);
      expect(sheetIndex, `${report.file} › ${report.sheet}`).toBeGreaterThanOrEqual(0);
      const regions = detectRegions(wb.sheets[sheetIndex]!, sheetIndex);
      expect(regions, `${report.file} › ${report.sheet}`).toHaveLength(1);
      const counts = countRowKinds(regions[0]!);
      const label = `${report.file} › ${report.sheet}`;
      expect(counts.data, label).toBe(report.dataRows);
      expect(counts.totals, label).toBe(report.skipped.totals);
      expect(counts.section, label).toBe(report.skipped.section);
      expect(counts.note, label).toBe(report.skipped.notes);
      expect(counts.title + (counts.blank - report.skipped.blank), label).toBe(
        report.skipped.title,
      );
    }
  });

  it('combine the stock list two-row header', () => {
    const wb = workbooks.get('Stock list & costs.xlsx')!;
    const [region] = detectRegions(wb.sheets[0]!, 0);
    expect(region!.columns.map((c) => c.header)).toEqual([
      'SKU',
      'Product',
      'Supplier',
      'Price Cost (ex tax)',
      'Price RRP',
      'Stock Pcs in stock',
      'Stock Reorder at',
      'Notes',
    ]);
  });
});

describe('profiling the demo files', () => {
  const profileOf = (file: string, sheet?: string) => {
    const wb = workbooks.get(file)!;
    const index = sheet ? wb.sheets.findIndex((s) => s.name === sheet) : 0;
    const [region] = detectRegions(wb.sheets[index]!, index);
    return profileRegion(wb.sheets[index]!, region!, { dateOrder: 'MDY', maskPii: true });
  };

  it('masks emails and spots day-first dates on Etsy', () => {
    const web = profileOf('Online orders 2025-26.xlsx', 'Website');
    const email = web.columns.find((c) => c.header === 'Email')!;
    expect(email.pii).toBe('email');
    expect(email.samples.every((s) => s === '' || /^\w\*\*\*@\w\*\*\*\.\w+$/.test(s))).toBe(true);
    expect(JSON.stringify(web.sampleRows)).not.toMatch(/@gmail\.com/);

    const etsy = profileOf('Online orders 2025-26.xlsx', 'Etsy');
    const saleDate = etsy.columns.find((c) => c.header === 'Sale Date')!;
    expect(saleDate.date?.impliedOrder).toBe('DMY');
    const price = etsy.columns.find((c) => c.header === 'Price')!;
    expect(price.kinds.money).toBe(price.filled);
    expect(price.currencies).toEqual({ $: price.filled });
  });

  it('sees order fields that need filling down on the website sheet', () => {
    const web = profileOf('Online orders 2025-26.xlsx', 'Website');
    const email = web.columns.find((c) => c.header === 'Email')!;
    expect(web.groupKeyColumn).toBe(0);
    expect(email.blankWithinGroup).toBeGreaterThan(500);
    const discountCode = web.columns.find((c) => c.header === 'Discount Code')!;
    expect(discountCode.blankWithinGroup).toBeLessThan(discountCode.blank);
  });

  it('finds units, sections and the Bloom & Co spellings', () => {
    const stock = profileOf('Stock list & costs.xlsx');
    expect(stock.sections).toHaveLength(10);
    const pcs = stock.columns.find((c) => c.header === 'Stock Pcs in stock')!;
    expect(pcs.units).toHaveProperty('pcs');

    const wholesale = profileOf('Wholesale invoices.xlsx', 'Q1 2026');
    const customer = wholesale.columns.find((c) => c.header === 'Customer')!;
    const bloom = customer.nearDuplicates.find((d) => d.key === 'bloom and co');
    expect(bloom?.variants.length).toBeGreaterThanOrEqual(2);
  });

  it('recognises wide month columns in the expenses sheet', () => {
    const expenses = profileOf('Expenses 2026.xlsx');
    expect(expenses.monthColumns.length).toBeGreaterThanOrEqual(9);
  });

  it('keeps the injection canary as plain data', () => {
    const web = profileOf('Online orders 2025-26.xlsx', 'Website');
    const notes = web.columns.find((c) => c.header === 'Notes')!;
    expect(notes.filled).toBe(1);
    expect(notes.samples[0]).toMatch(/^Ignore all previous instructions/);
    expect(notes.samples[0]!.length).toBeLessThanOrEqual(80);
  });
});
