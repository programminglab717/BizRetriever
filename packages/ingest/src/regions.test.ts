import { describe, expect, it } from 'vitest';

import type { Cell, RawSheet } from './grid';
import { countRowKinds, detectRegions } from './regions';

function sheet(rows: Cell[][], merges: RawSheet['merges'] = []): RawSheet {
  const width = Math.max(...rows.map((r) => r.length));
  return {
    name: 'S',
    rows: rows.map((r) => [...r, ...Array<Cell>(width - r.length).fill(null)]),
    width,
    merges,
  };
}

describe('detectRegions', () => {
  it('finds a plain header on the first row', () => {
    const [r] = detectRegions(
      sheet([
        ['Date', 'Item', 'Qty'],
        ['2026-03-04', 'Mug', 2],
        ['2026-03-05', 'Cup', 1],
      ]),
      0,
    );
    expect(r!.headerRows).toEqual([0]);
    expect(r!.columns.map((c) => c.header)).toEqual(['Date', 'Item', 'Qty']);
    expect(countRowKinds(r!).data).toBe(2);
  });

  it('skips title rows and classifies totals, blanks and notes', () => {
    const [r] = detectRegions(
      sheet([
        ['FERNWOOD SALES 2026'],
        ['Exported Mar 4 2026'],
        [],
        ['Order', 'Date', 'Customer', 'Total'],
        ['#1001', '2026-03-01', 'Ann', 20],
        [],
        ['#1002', '2026-03-02', 'Bob', 35],
        ['Prices include sales tax where charged by the state.'],
        ['TOTAL', null, null, 55],
      ]),
      0,
    );
    expect(r!.headerRows).toEqual([3]);
    expect(countRowKinds(r!)).toMatchObject({ title: 2, blank: 2, data: 2, totals: 1, note: 1 });
  });

  it('combines a two-row header with merged group labels', () => {
    const [r] = detectRegions(
      sheet(
        [
          [null, null, 'Price', null, 'Stock', null],
          ['SKU', 'Product', 'Cost (ex tax)', 'RRP', 'Pcs in stock', 'Reorder at'],
          ['MUGS & CUPS'],
          ['FW-1', 'Sage Mug', 7.2, 18, '45 pcs', 10],
          ['FW-2', 'Oat Mug', 7.2, 18, 12, 10],
          ['CANDLES'],
          ['FW-3', 'Fig Candle', 5.1, 16, 20, 8],
          ['DISCONTINUED - do not reorder'],
        ],
        [
          { top: 0, left: 2, bottom: 0, right: 3 },
          { top: 0, left: 4, bottom: 0, right: 5 },
        ],
      ),
      0,
    );
    expect(r!.headerRows).toEqual([0, 1]);
    expect(r!.columns.map((c) => c.header)).toEqual([
      'SKU',
      'Product',
      'Price Cost (ex tax)',
      'Price RRP',
      'Stock Pcs in stock',
      'Stock Reorder at',
    ]);
    expect(countRowKinds(r!)).toMatchObject({ header: 2, section: 2, data: 3, note: 1 });
    const labels = r!.sectionLabels.filter((l) => l !== null);
    expect(labels).toEqual(['MUGS & CUPS', 'MUGS & CUPS', 'CANDLES']);
  });

  it('does not mistake a sheet-wide merged title for a group header', () => {
    const [r] = detectRegions(
      sheet(
        [['Big Title'], ['A', 'B', 'C'], [1, 2, 3], [4, 5, 6]],
        [{ top: 0, left: 0, bottom: 0, right: 2 }],
      ),
      0,
    );
    expect(r!.headerRows).toEqual([1]);
    expect(r!.rowKinds[0]).toBe('title');
  });

  it('treats a repeated header row as a header, not data', () => {
    const [r] = detectRegions(
      sheet([
        ['Date', 'Item', 'Qty'],
        ['2026-03-04', 'Mug', 2],
        ['Date', 'Item', 'Qty'],
        ['2026-03-05', 'Cup', 1],
      ]),
      0,
    );
    expect(countRowKinds(r!)).toMatchObject({ header: 2, data: 2 });
  });

  it('splits two tables separated by blank rows', () => {
    const regions = detectRegions(
      sheet([
        ['Date', 'Item', 'Qty'],
        ['2026-03-04', 'Mug', 2],
        ['2026-03-05', 'Cup', 1],
        [],
        [],
        ['Supplier', 'Phone', 'Lead days'],
        ['Kiln Co', '555-0100', 14],
        ['Wick Co', '555-0101', 10],
      ]),
      0,
    );
    expect(regions).toHaveLength(2);
    expect(regions[1]!.columns.map((c) => c.header)).toEqual(['Supplier', 'Phone', 'Lead days']);
  });

  it('names columns that have data but no header', () => {
    const [r] = detectRegions(
      sheet([
        ['Date', 'Item', null],
        ['2026-03-04', 'Mug', 'x'],
        ['2026-03-05', 'Cup', 'y'],
      ]),
      0,
    );
    expect(r!.columns.map((c) => c.header)).toEqual(['Date', 'Item', 'Column C']);
  });
});
