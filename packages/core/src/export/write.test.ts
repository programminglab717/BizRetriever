import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import type { AnswerData } from '../ask/answer';
import { answerSheet, fieldColumn, fileNameFor, type Sheet } from './sheet';
import { sheetNames, toCsv, toXlsx } from './write';

const sheet: Sheet = {
  name: 'Sales',
  columns: [
    { label: 'Product', type: 'text' },
    { label: 'Revenue (USD)', type: 'money' },
    { label: 'Margin', type: 'percent' },
    { label: 'Day', type: 'date' },
    { label: 'When', type: 'datetime' },
    { label: 'Units', type: 'number' },
  ],
  rows: [
    ['Fern pot, large', '1234567.8900', 0.125, '2026-10-01', '2026-10-01T09:30:00', 3],
    ['=HYPERLINK("http://x")', '-0.0100', '0.5', null, null, null],
    ['He said "hi"', null, null, null, null, 0],
  ],
};

describe('toCsv', () => {
  const csv = toCsv(sheet);
  const lines = csv.slice(1).split('\r\n');

  it('starts with a byte-order mark and ends each line with CRLF', () => {
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(lines).toHaveLength(5);
  });

  it('keeps money exact and writes percents as percent numbers', () => {
    expect(lines[0]).toBe('Product,Revenue (USD),Margin (%),Day,When,Units');
    expect(lines[1]).toBe('"Fern pot, large",1234567.8900,12.5,2026-10-01,2026-10-01 09:30:00,3');
    expect(lines[2]?.split(',').slice(-5)).toEqual(['-0.0100', '50', '', '', '']);
  });

  it('stops text from running as a formula and quotes per RFC 4180', () => {
    expect(lines[2]?.startsWith(`"'=HYPERLINK(""http://x"")"`)).toBe(true);
    expect(lines[3]).toBe('"He said ""hi""",,,,,0');
    for (const start of ['+1', '-1', '@SUM(A1)', '\tx'])
      expect(
        toCsv({ ...sheet, rows: [[start, null, null, null, null, null]] }).split('\r\n')[1],
      ).toBe(`'${start},,,,,`);
  });
});

describe('toXlsx', () => {
  async function read(bytes: Uint8Array) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer as ArrayBuffer);
    return wb;
  }

  it('writes typed cells with number formats, a frozen bold header and an About tab', async () => {
    const wb = await read(
      await toXlsx([sheet], [{ label: 'Question', value: 'Sales by product' }]),
    );
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Sales', 'About this file']);
    const ws = wb.worksheets[0]!;
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(ws.getRow(1).font?.bold).toBe(true);
    const r = ws.getRow(2);
    expect(r.getCell(1).value).toBe('Fern pot, large');
    expect(r.getCell(2).value).toBe(1234567.89);
    expect(r.getCell(2).numFmt).toBe('#,##0.00');
    expect(r.getCell(3).value).toBe(0.125);
    expect(r.getCell(3).numFmt).toBe('0.0%');
    expect((r.getCell(4).value as Date).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect((r.getCell(5).value as Date).toISOString()).toBe('2026-10-01T09:30:00.000Z');
    // Text that looks like a formula stays text.
    expect(ws.getRow(3).getCell(1).value).toBe('=HYPERLINK("http://x")');
    expect(wb.worksheets[1]!.getRow(1).values).toEqual([undefined, 'Question', 'Sales by product']);
  });
});

describe('sheetNames', () => {
  it('follows Excel’s rules', () => {
    expect(sheetNames(['A/B: C?', 'Sales', 'sales', 'History', 'x'.repeat(40), ''])).toEqual([
      'A B  C',
      'Sales',
      'sales 2',
      'History 2',
      'x'.repeat(31),
      'Sheet',
    ]);
  });
});

describe('answerSheet', () => {
  const data: AnswerData = {
    columns: [
      { key: 'd_month', label: 'Month', kind: 'dimension', time: 'month' },
      { key: 'd_channel', label: 'Channel', kind: 'dimension', field: 'sale.channel' },
      { key: 'm_revenue', label: 'Revenue', kind: 'metric', format: 'money', metric: 'revenue' },
      { key: 'm_revenue__prev', label: 'Revenue (before)', kind: 'previous', format: 'money' },
      { key: 'm_margin', label: 'Margin', kind: 'metric', format: 'percent', metric: 'margin' },
    ],
    rows: [
      {
        d_month: '2026-09-01',
        d_channel: 'online_store',
        m_revenue: '10.5000',
        m_revenue__prev: null,
        m_margin: 0.4,
      },
      {
        d_month: null,
        d_channel: null,
        m_revenue: '0.0000',
        m_revenue__prev: '1.0000',
        m_margin: null,
      },
    ],
    totalRows: 2,
    truncated: false,
  };
  const pack = {
    metrics: {
      dimensions: [
        {
          field: 'sale.channel',
          label: 'Channel',
          synonyms: [],
          value_labels: { online_store: 'Website' },
        },
      ],
    },
  } as unknown as Parameters<typeof answerSheet>[2]['pack'];

  it('labels breakdowns as the owner saw them and keeps numbers as values', () => {
    const s = answerSheet('Answer', data, {
      pack,
      locale: 'en-US',
      currency: 'USD',
      fiscalYearStartMonth: 1,
      comparedWith: 'August 2026',
    });
    expect(s.columns.map((c) => c.label)).toEqual([
      'Month',
      'Channel',
      'Revenue (USD)',
      'Revenue (August 2026) (USD)',
      'Margin',
    ]);
    expect(s.rows).toEqual([
      ['Sep 2026', 'Website', '10.5000', null, 0.4],
      ['Unknown', 'Not recorded', '0.0000', '1.0000', null],
    ]);
  });
});

describe('fieldColumn and fileNameFor', () => {
  it('shows yes/no and coded values in words', () => {
    const yes = fieldColumn(
      { key: 'active', label: 'Active', type: 'boolean', required: false },
      'USD',
    );
    expect([yes.cell('true'), yes.cell('false'), yes.cell(null)]).toEqual(['Yes', 'No', null]);
    const coded = fieldColumn(
      {
        key: 'channel',
        label: 'Channel',
        type: 'text',
        required: false,
        valueLabels: { online_store: 'Website' },
      },
      'USD',
    );
    expect(coded.cell('online_store')).toBe('Website');
    expect(
      fieldColumn({ key: 'p', label: 'Price', type: 'money', required: false }, 'EUR').label,
    ).toBe('Price (EUR)');
  });

  it('makes safe file names', () => {
    expect(fileNameFor('Revenue by product · Sep 2026', 'csv')).toBe(
      'Revenue by product Sep 2026.csv',
    );
    expect(fileNameFor('../../etc/passwd', 'xlsx')).toBe('etcpasswd.xlsx');
    expect(fileNameFor('', 'csv')).toBe('download.csv');
  });
});
