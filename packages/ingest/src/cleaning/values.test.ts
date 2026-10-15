import { describe, expect, it } from 'vitest';

import { cleanValue, evalExpr } from './values';

const ctx = { dateOrder: 'MDY' as const };

describe('cleanValue', () => {
  it('coerces messy money, units and percentages with default parsing', () => {
    expect(cleanValue('$18.00', [], 'money', ctx)).toEqual({ ok: true, value: 18 });
    expect(cleanValue('(45.00)', [], 'money', ctx)).toEqual({ ok: true, value: -45 });
    expect(cleanValue('12 pcs', [], 'decimal', ctx)).toEqual({ ok: true, value: 12 });
    expect(cleanValue('15%', [], 'percent', ctx)).toEqual({ ok: true, value: 0.15 });
    expect(cleanValue(7.199999, [], 'money', ctx)).toEqual({ ok: true, value: 7.2 });
  });

  it('treats blanks and dash placeholders as missing, not zero', () => {
    for (const v of [null, '', '  ', '–', '-', 'N/A', 'tbc']) {
      expect(cleanValue(v, [], 'money', ctx)).toEqual({ ok: true, value: null });
    }
  });

  it('explains values it cannot read, in plain language', () => {
    expect(cleanValue('twelve', [], 'integer', ctx)).toEqual({
      ok: false,
      reason: 'couldn’t read “twelve” as a number',
    });
    expect(cleanValue('2.5', [], 'integer', ctx)).toEqual({
      ok: false,
      reason: '“2.5” isn’t a whole number',
    });
    expect(cleanValue('31/02/2026', [], 'date', ctx)).toEqual({
      ok: false,
      reason: 'couldn’t read “31/02/2026” as a date',
    });
  });

  it('parses dates using the workspace order unless a rule says otherwise', () => {
    expect(cleanValue('03/04/2026', [], 'date', ctx)).toEqual({
      ok: true,
      value: { kind: 'date', date: '2026-03-04' },
    });
    expect(cleanValue('03/04/2026', [{ rule: 'parse_date', order: 'DMY' }], 'date', ctx)).toEqual({
      ok: true,
      value: { kind: 'date', date: '2026-04-03' },
    });
    expect(cleanValue('2026-03-04 14:22:10 -0400', [], 'datetime', ctx)).toEqual({
      ok: true,
      value: { kind: 'date', date: '2026-03-04', time: '14:22:10', offsetMinutes: -240 },
    });
    expect(cleanValue(new Date('2026-03-04T00:00:00Z'), [], 'date', ctx)).toEqual({
      ok: true,
      value: { kind: 'date', date: '2026-03-04' },
    });
  });

  it('maps yes/no style values', () => {
    expect(cleanValue('✓', [], 'boolean', ctx)).toEqual({ ok: true, value: true });
    expect(cleanValue('N', [], 'boolean', ctx)).toEqual({ ok: true, value: false });
    expect(
      cleanValue(
        'part',
        [{ rule: 'map_values', map: { y: 'paid', '✓': 'paid', n: 'unpaid', part: 'partial' } }],
        'text',
        ctx,
      ),
    ).toEqual({
      ok: true,
      value: 'partial',
    });
  });

  it('applies rules in order', () => {
    expect(
      cleanValue('  BLOOM & CO  ', [{ rule: 'trim' }, { rule: 'case', to: 'title' }], 'text', ctx),
    ).toEqual({ ok: true, value: 'Bloom & Co' });
    expect(
      cleanValue('Mug | Sage', [{ rule: 'split_column', delimiter: '|', part: 1 }], 'text', ctx),
    ).toEqual({
      ok: true,
      value: 'Sage',
    });
    expect(
      cleanValue('3 boxes', [{ rule: 'strip_unit', units: ['boxes'], factor: 12 }], 'decimal', ctx),
    ).toEqual({
      ok: true,
      value: 36,
    });
    expect(cleanValue('-2', [{ rule: 'negate' }], 'decimal', ctx)).toEqual({ ok: true, value: 2 });
    expect(cleanValue('TBC', [{ rule: 'null_if', values: ['tbc'] }], 'text', ctx)).toEqual({
      ok: true,
      value: null,
    });
  });

  it('turns month names into the first day of the month', () => {
    expect(cleanValue('Jan', [{ rule: 'month_start', year: 2026 }], 'date', ctx)).toEqual({
      ok: true,
      value: { kind: 'date', date: '2026-01-01' },
    });
    expect(cleanValue('September', [{ rule: 'month_start', year: 2026 }], 'date', ctx)).toEqual({
      ok: true,
      value: { kind: 'date', date: '2026-09-01' },
    });
    expect(cleanValue("Mar '25", [{ rule: 'month_start', year: 2026 }], 'date', ctx)).toEqual({
      ok: true,
      value: { kind: 'date', date: '2025-03-01' },
    });
    expect(cleanValue('TOTAL', [{ rule: 'month_start', year: 2026 }], 'date', ctx)).toMatchObject({
      ok: false,
    });
  });

  it('can reject unexpected values', () => {
    expect(
      cleanValue(
        'maybe',
        [{ rule: 'map_values', map: { y: 'paid' }, otherwise: 'error' }],
        'text',
        ctx,
      ),
    ).toMatchObject({
      ok: false,
    });
  });

  it('keeps identifier numbers as text without decimals', () => {
    expect(cleanValue(1043, [], 'text', ctx)).toEqual({ ok: true, value: '1043' });
  });
});

describe('evalExpr', () => {
  const fields = { quantity: 3, unit_price: 18, discount: 5.4, missing: null };
  it('computes line totals', () => {
    expect(
      evalExpr(
        {
          op: 'sub',
          args: [
            { op: 'mul', args: [{ field: 'quantity' }, { field: 'unit_price' }] },
            { coalesce: [{ field: 'discount' }, { const: 0 }] },
          ],
        },
        fields,
      ),
    ).toBe(48.6);
  });

  it('returns null for missing inputs and division by zero', () => {
    expect(evalExpr({ op: 'mul', args: [{ field: 'missing' }, { const: 2 }] }, fields)).toBeNull();
    expect(evalExpr({ op: 'div', args: [{ const: 1 }, { const: 0 }] }, fields)).toBeNull();
    expect(evalExpr({ coalesce: [{ field: 'missing' }, { const: 0 }] }, fields)).toBe(0);
  });
});
