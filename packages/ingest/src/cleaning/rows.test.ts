import { describe, expect, it } from 'vitest';

import type { Cell, RawSheet } from '../grid';
import { detectRegions } from '../regions';
import { buildRecords, readColumn } from './rows';

function sheet(name: string, rows: Cell[][]): RawSheet {
  const width = Math.max(...rows.map((r) => r.length));
  return {
    name,
    rows: rows.map((r) => [...r, ...Array<Cell>(width - r.length).fill(null)]),
    width,
    merges: [],
  };
}

describe('buildRecords', () => {
  const orders = sheet('Website', [
    ['WEBSITE ORDERS'],
    ['Name', 'Email', 'Created at', 'Qty', 'Item'],
    ['#1001', 'a@x.com', '2026-03-01', 1, 'Mug'],
    ['#1001', null, null, 2, 'Cup'],
    ['#1002', 'b@x.com', '2026-03-02', 1, 'Mug'],
    ['#1003', null, '2026-03-03', 1, 'Vase'],
    ['TOTAL', null, null, 5, null],
  ]);
  const [region] = detectRegions(orders, 0);

  it('keeps data rows with Excel row numbers and reports the rest as skipped', () => {
    const { records, skipped } = buildRecords(orders, region!, []);
    expect(records.map((r) => r.sheetRow)).toEqual([3, 4, 5, 6]);
    expect(skipped.map((s) => [s.sheetRow, s.reason])).toEqual([
      [1, 'title'],
      [2, 'header'],
      [7, 'totals'],
    ]);
    expect(readColumn(records[0]!, 'sheet_name')).toBe('Website');
  });

  it('fills down only within the same order when asked to', () => {
    const { records } = buildRecords(orders, region!, [
      { rule: 'fill_down', columns: [1, 2], withinGroup: 0 },
    ]);
    expect(records.map((r) => r.cells[1])).toEqual(['a@x.com', 'a@x.com', 'b@x.com', null]);
    expect(records.map((r) => r.cells[2])).toEqual([
      '2026-03-01',
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
    ]);
  });

  it('fills down across everything without a group', () => {
    const { records } = buildRecords(orders, region!, [{ rule: 'fill_down', columns: [1] }]);
    expect(records.at(-1)!.cells[1]).toBe('b@x.com');
  });

  it('skips rows by rule with a reason', () => {
    const { records, skipped } = buildRecords(orders, region!, [
      {
        rule: 'skip_rows',
        where: { column: 4, equals: ['vase'] },
        reason: 'Not a product we sell',
      },
      { rule: 'skip_rows', rows: [3], reason: 'Test order' },
    ]);
    expect(records.map((r) => r.sheetRow)).toEqual([4, 5]);
    expect(skipped.filter((s) => s.reason === 'rule').map((s) => [s.sheetRow, s.detail])).toEqual([
      [3, 'Test order'],
      [6, 'Not a product we sell'],
    ]);
  });

  it('carries section labels as a virtual column', () => {
    const stock = sheet('Stock', [
      ['SKU', 'Product', 'Cost'],
      ['CANDLES'],
      ['C1', 'Fig Candle', 5],
      ['C2', 'Sea Candle', 5],
      ['MUGS'],
      ['M1', 'Sage Mug', 7],
    ]);
    const [r] = detectRegions(stock, 0);
    const { records } = buildRecords(stock, r!, []);
    expect(records.map((x) => readColumn(x, 'section'))).toEqual(['CANDLES', 'CANDLES', 'MUGS']);
  });

  it('unpivots month columns into one record per value, dropping blanks and dashes', () => {
    const expenses = sheet('2026', [
      ['Category', 'Jan', 'Feb', 'Mar', 'TOTAL'],
      ['Rent', 2400, 2400, 2400, 7200],
      ['Repairs', '–', 120, null, 120],
      ['TOTAL', 2400, 2520, 2400, 7320],
    ]);
    const [r] = detectRegions(expenses, 0);
    const { records } = buildRecords(expenses, r!, [{ rule: 'unpivot', columns: [1, 2, 3] }]);
    expect(
      records.map((x) => [
        x.cells[0],
        readColumn(x, 'unpivot_key'),
        readColumn(x, 'unpivot_value'),
      ]),
    ).toEqual([
      ['Rent', 'Jan', 2400],
      ['Rent', 'Feb', 2400],
      ['Rent', 'Mar', 2400],
      ['Repairs', 'Feb', 120],
    ]);
    expect(records[3]!.sourceColumn).toBe(2);
  });
});
