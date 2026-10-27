import { describe, expect, it } from 'vitest';

import { pdfText } from '../testing/pdf';
import { pdfSafe, toPdf } from './pdf';

const table = {
  columns: [
    { key: 'd0', label: 'Product', kind: 'dimension' as const },
    { key: 'm0', label: 'Net sales', kind: 'metric' as const, format: 'money' as const },
  ],
  rows: [
    {
      key: '0',
      label: 'Sage Stoneware Mug',
      cells: [
        { text: 'Sage Stoneware Mug', value: null },
        { text: '$1,204.50', value: 1204.5 },
      ],
    },
    {
      key: '1',
      label: 'Linen Napkin Set',
      cells: [
        { text: 'Linen Napkin Set', value: null },
        { text: '$980.00', value: 980 },
      ],
    },
  ],
  totalRows: 2,
};

/** M15 (ADR-065): the PDF lays out the values it is given, as given. */
describe('toPdf', () => {
  it('writes the title, the sentence, every value as formatted, and page numbers', async () => {
    const bytes = await toPdf(
      {
        title: 'Net sales by product',
        subtitle: 'Fernwood Home & Gift · Last month',
        blocks: [
          {
            paragraphs: ['Sage Stoneware Mug sold the most: $1,204.50.'],
            chart: 'bar_horizontal',
            table,
            steps: ['Added up every sale last month.'],
            notes: ['Refunds count on the day of the return.'],
          },
        ],
        about: [{ label: 'Downloaded', value: '27 Oct 2026, 09:00' }],
      },
      { compress: false },
    );
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    const text = pdfText(bytes).join('\n');
    for (const s of [
      'Net sales by product',
      'Sage Stoneware Mug',
      '$1,204.50',
      '$980.00',
      'Added up every sale last month.',
      'Refunds count on the day of the return.',
      'Downloaded: 27 Oct 2026, 09:00',
      'Page 1 of 1',
    ])
      expect(text).toContain(s);
  });

  it('runs long tables over several pages, repeating the headings', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      key: String(i),
      label: `Product ${i}`,
      cells: [
        { text: `Product ${i}`, value: null },
        { text: `$${i}.00`, value: i },
      ],
    }));
    const bytes = await toPdf(
      {
        title: 'Long',
        subtitle: 'x',
        blocks: [{ table: { ...table, rows, totalRows: 120 } }],
        about: [],
      },
      { compress: false },
    );
    const text = pdfText(bytes);
    expect(text.filter((t) => t === 'Net sales').length).toBeGreaterThan(1);
    expect(text.join('\n')).toContain('Product 119');
    expect(text.join('\n')).toMatch(/Page 3 of 3/);
  });

  it('keeps text the built-in font can print', () => {
    expect(pdfSafe('Corner Bloom Café → €12 ✓ 日本')).toBe('Corner Bloom Café -> €12 yes ??');
  });
});
