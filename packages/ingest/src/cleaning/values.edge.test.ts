import { describe, expect, it } from 'vitest';

import { cleanValue, evalExpr } from './values';

/** Edge cases of each value rule: non-text inputs, failures and fallbacks. */
const ctx = { dateOrder: 'MDY' as const };
const ok = (value: unknown) => ({ ok: true, value });

describe('value rules on non-text input', () => {
  it('leaves numbers alone in text rules', () => {
    expect(cleanValue(5, [{ rule: 'trim' }], 'integer', ctx)).toEqual(ok(5));
    expect(cleanValue(5, [{ rule: 'collapse_whitespace' }], 'integer', ctx)).toEqual(ok(5));
    expect(cleanValue(5, [{ rule: 'case', to: 'upper' }], 'integer', ctx)).toEqual(ok(5));
    expect(cleanValue('  a   b ', [{ rule: 'collapse_whitespace' }], 'text', ctx)).toEqual(
      ok('a b'),
    );
    expect(cleanValue('mUG', [{ rule: 'case', to: 'lower' }], 'text', ctx)).toEqual(ok('mug'));
  });

  it('parse_number: numbers pass, percent options, failures explained', () => {
    expect(cleanValue(3, [{ rule: 'parse_number' }], 'decimal', ctx)).toEqual(ok(3));
    expect(
      cleanValue('1.234,50', [{ rule: 'parse_number', decimalSeparator: ',' }], 'decimal', ctx),
    ).toEqual(ok(1234.5));
    expect(
      cleanValue('15%', [{ rule: 'parse_number', percent: 'number' }], 'decimal', ctx),
    ).toEqual(ok(15));
    expect(cleanValue('lots', [{ rule: 'parse_number' }], 'decimal', ctx)).toEqual({
      ok: false,
      reason: 'couldn’t read “lots” as a number',
    });
  });

  it('parse_date: dates pass through, serials when allowed, failures explained', () => {
    const d = cleanValue('2026-03-04', [{ rule: 'parse_date' }], 'date', ctx);
    expect(d).toEqual(ok({ kind: 'date', date: '2026-03-04' }));
    expect(
      cleanValue(46085, [{ rule: 'parse_date', allowSerial: true }], 'date', ctx),
    ).toMatchObject({ ok: true });
    expect(cleanValue('soon', [{ rule: 'parse_date' }], 'date', ctx)).toEqual({
      ok: false,
      reason: 'couldn’t read “soon” as a date',
    });
  });

  it('parse_boolean: custom words and failures', () => {
    expect(cleanValue(true, [{ rule: 'parse_boolean' }], 'boolean', ctx)).toEqual(ok(true));
    expect(
      cleanValue(
        'sent',
        [{ rule: 'parse_boolean', trueValues: ['sent'], falseValues: ['draft'] }],
        'boolean',
        ctx,
      ),
    ).toEqual(ok(true));
    expect(cleanValue('maybe', [{ rule: 'parse_boolean' }], 'boolean', ctx)).toEqual({
      ok: false,
      reason: 'couldn’t read “maybe” as yes or no',
    });
  });

  it('strip_unit: factors, unknown units and unreadable text', () => {
    expect(
      cleanValue(2, [{ rule: 'strip_unit', units: ['kg'], factor: 1000 }], 'decimal', ctx),
    ).toEqual(ok(2000));
    expect(
      cleanValue('2 kg', [{ rule: 'strip_unit', units: ['kg'], factor: 1000 }], 'decimal', ctx),
    ).toEqual(ok(2000));
    expect(cleanValue('2 lb', [{ rule: 'strip_unit', units: ['kg'] }], 'decimal', ctx)).toEqual({
      ok: false,
      reason: 'unexpected unit “lb” in “2 lb”',
    });
    expect(
      cleanValue('heavy', [{ rule: 'strip_unit', units: ['kg'] }], 'decimal', ctx),
    ).toMatchObject({
      ok: false,
    });
  });

  it('map_values: keep, null or error for values not in the map', () => {
    const map = { Web: 'online_store' };
    expect(cleanValue('Fair', [{ rule: 'map_values', map }], 'text', ctx)).toEqual(ok('Fair'));
    expect(
      cleanValue('Fair', [{ rule: 'map_values', map, otherwise: 'null' }], 'text', ctx),
    ).toEqual(ok(null));
    expect(
      cleanValue('Fair', [{ rule: 'map_values', map, otherwise: 'error' }], 'text', ctx),
    ).toEqual({
      ok: false,
      reason: '“Fair” isn’t one of the expected values',
    });
  });

  it('coerces booleans, dates and whole numbers by type', () => {
    expect(cleanValue(true, [], 'boolean', ctx)).toEqual(ok(true));
    expect(cleanValue(true, [], 'decimal', ctx)).toMatchObject({ ok: false });
    expect(cleanValue('4', [], 'integer', ctx)).toEqual(ok(4));
    expect(cleanValue(new Date(Date.UTC(2026, 2, 4)), [], 'date', ctx)).toEqual(
      ok({ kind: 'date', date: '2026-03-04' }),
    );
  });
});

describe('evalExpr', () => {
  const fields = { a: 6, b: 3, c: null, t: 'x' };
  it('adds, subtracts, multiplies and divides', () => {
    expect(evalExpr({ op: 'add', args: [{ field: 'a' }, { field: 'b' }] }, fields)).toBe(9);
    expect(evalExpr({ op: 'sub', args: [{ field: 'a' }, { field: 'b' }] }, fields)).toBe(3);
    expect(evalExpr({ op: 'mul', args: [{ field: 'a' }, { const: 2 }] }, fields)).toBe(12);
    expect(evalExpr({ op: 'div', args: [{ field: 'a' }, { field: 'b' }] }, fields)).toBe(2);
  });
  it('returns null for missing inputs, text and division by zero', () => {
    expect(evalExpr({ op: 'add', args: [{ field: 'a' }, { field: 'c' }] }, fields)).toBeNull();
    expect(evalExpr({ op: 'add', args: [{ field: 'a' }, { field: 't' }] }, fields)).toBeNull();
    expect(evalExpr({ op: 'div', args: [{ field: 'a' }, { const: 0 }] }, fields)).toBeNull();
    expect(evalExpr({ coalesce: [{ field: 'c' }, { field: 't' }] }, fields)).toBeNull();
  });
});
