import { describe, expect, it } from 'vitest';

import { parseNumber } from './numbers';

describe('parseNumber', () => {
  it.each([
    ['42', { value: 42 }],
    ['1,234.50', { value: 1234.5 }],
    ['$18.00', { value: 18, currency: '$' }],
    ['-$5.95', { value: -5.95, currency: '$' }],
    ['(45.00)', { value: -45 }],
    ['12.50 USD', { value: 12.5, currency: 'USD' }],
    ['USD 12.50', { value: 12.5, currency: 'USD' }],
    ['€1.234,50', { value: 1234.5, currency: '€' }],
    ['12,50', { value: 12.5 }],
    ['1,234', { value: 1234 }],
    ['45 pcs', { value: 45, unit: 'pcs' }],
    ['12pcs', { value: 12, unit: 'pcs' }],
    ['3 boxes', { value: 3, unit: 'boxes' }],
    ['15%', { value: 15, percent: true }],
    ['−3', { value: -3 }],
    ['1 234 567', { value: 1234567 }],
    ["1'234.5", { value: 1234.5 }],
    ['.5', { value: 0.5 }],
    ['Rs 1,500', { value: 1500, currency: 'Rs' }],
  ])('parses %j', (input, expected) => {
    expect(parseNumber(input)).toEqual(expected);
  });

  it.each([
    '',
    'abc',
    '12 apples',
    '1.2.3',
    '12,34,56',
    'N/A',
    '-',
    '–',
    '2026-03-04',
    '03/04/2026',
    'TOTAL',
  ])('rejects %j', (input) => {
    expect(parseNumber(input)).toBeUndefined();
  });

  it('passes numbers through and rejects non-finite ones', () => {
    expect(parseNumber(7.25)).toEqual({ value: 7.25 });
    expect(parseNumber(Number.NaN)).toBeUndefined();
    expect(parseNumber(null)).toBeUndefined();
  });

  it('honours a forced decimal comma', () => {
    expect(parseNumber('1.234', { decimalSeparator: ',' })).toEqual({ value: 1234 });
    expect(parseNumber('1,5', { decimalSeparator: ',' })).toEqual({ value: 1.5 });
  });
});
