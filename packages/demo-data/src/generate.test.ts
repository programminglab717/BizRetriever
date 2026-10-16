import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';

import { generateDemoDataset, type GroundTruth } from './index';

const TODAY = '2026-10-13';
let dir: string;
let truth: GroundTruth;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'fernwood-'));
  truth = await generateDemoDataset({ today: TODAY, seed: 42, outDir: dir });
}, 30_000);

describe('demo dataset generator', () => {
  it('is deterministic for a given seed and date', async () => {
    const again = await generateDemoDataset({
      today: TODAY,
      seed: 42,
      outDir: mkdtempSync(path.join(tmpdir(), 'fernwood-')),
    });
    expect(again).toEqual(truth);
  }, 30_000);

  it('plants every story within the ranges the demo script relies on', () => {
    const s = truth.stories as Record<string, Record<string, number | string | unknown[]>>;
    expect(s.stockoutRisk!.daysOfCover).toBeGreaterThanOrEqual(5);
    expect(s.stockoutRisk!.daysOfCover).toBeLessThanOrEqual(7);
    expect(s.slippingCustomer!.dropPct).toBeGreaterThanOrEqual(55);
    expect(s.slippingCustomer!.daysSinceLastOrder).toBe(41);
    expect(s.deadStock!.top).toBe('Christmas Spice Candle');
    expect(s.marginSqueeze!.costChangePct).toBe(22);
    expect(s.returnSpike!.returnRatePct).toBeGreaterThanOrEqual(12);
    expect(s.risingStar!.changePct).toBeGreaterThanOrEqual(50);
    expect(
      Number(s.channelShift!.sharePctLast90Days) - Number(s.channelShift!.sharePctPrior90Days),
    ).toBeGreaterThanOrEqual(8);
    expect(s.overduePayments!.customers).toEqual(
      expect.arrayContaining(['Harbor Home', 'North Star Mercantile']),
    );
  });

  it('runs the control business steadily, with none of the stories', async () => {
    const control = await generateDemoDataset({
      today: TODAY,
      seed: 42,
      outDir: mkdtempSync(path.join(tmpdir(), 'fernwood-control-')),
      stories: false,
    });
    const s = control.stories as Record<string, Record<string, number | string | unknown[]>>;
    expect(s.stockoutRisk!.daysOfCover).toBeGreaterThan(14);
    expect(s.slippingCustomer!.dropPct).toBeLessThan(50);
    expect(s.deadStock!.totalValueAtCost).toBeLessThan(100);
    expect(s.returnSpike!.returnRatePct).toBeLessThan(10);
    expect(s.overduePayments!.invoices).toEqual([]);
    expect(
      Number(s.channelShift!.sharePctLast90Days) - Number(s.channelShift!.sharePctPrior90Days),
    ).toBeLessThan(5);
    // Same shape of business: the same files and products.
    expect(control.files.map((f) => f.sheet)).toEqual(truth.files.map((f) => f.sheet));
    expect(control.counts.products).toBe(truth.counts.products);
  }, 30_000);

  it('writes the messy workbook features the importer must handle', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(dir, 'Online orders 2025-26.xlsx'));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Website', 'Etsy', 'Returns log']);
    const web = wb.getWorksheet('Website')!;
    expect(web.getCell('A1').text).toContain('WEBSITE ORDERS');
    expect(web.getCell('A1').isMerged).toBe(true);
    expect(web.getRow(4).getCell(1).value).toBe('Name');
    const etsy = wb.getWorksheet('Etsy')!;
    expect(etsy.getRow(3).getCell(1).text).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(etsy.getRow(3).getCell(5).text).toMatch(/^\$\d+\.\d{2}$/);

    const stock = new ExcelJS.Workbook();
    await stock.xlsx.readFile(path.join(dir, 'Stock list & costs.xlsx'));
    const ws = stock.getWorksheet('Stock list')!;
    expect(ws.getCell('D1').value).toBe('Price');
    expect(ws.getCell('D1').isMerged).toBe(true);
    expect(ws.getRow(3).getCell(1).value).toBe('MUGS & CUPS');
  });

  it('writes the till export in Windows-1252', () => {
    const bytes = readFileSync(path.join(dir, 'Shop till export.csv'));
    const utf8Cafe = Buffer.from('Café', 'utf8');
    const latin1Cafe = Buffer.from([0x43, 0x61, 0x66, 0xe9]);
    expect(bytes.includes(latin1Cafe)).toBe(true);
    expect(bytes.includes(utf8Cafe)).toBe(false);
  });

  it('reports what a perfect import should skip', () => {
    const website = truth.files.find((f) => f.sheet === 'Website')!;
    expect(website.skipped.totals).toBe(2);
    expect(website.skipped.blank).toBeGreaterThanOrEqual(3);
    const stock = truth.files.find((f) => f.sheet === 'Stock list')!;
    expect(stock.skipped.section).toBe(10);
    expect(stock.dataRows).toBe(truth.counts.products);
  });
});
