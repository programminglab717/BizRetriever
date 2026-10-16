import { describe, expect, it } from 'vitest';

import { parseEditValue, titleFieldOf } from './values';

const f = (type: string, extra: Record<string, unknown> = {}) =>
  ({ key: 'x', label: 'Quantity', type, required: false, pii: false, ...extra }) as Parameters<
    typeof parseEditValue
  >[0];

describe('parseEditValue', () => {
  it('reads numbers the way people type them', () => {
    expect(parseEditValue(f('money'), '$1,234.50')).toEqual({ ok: true, value: '1234.50' });
    expect(parseEditValue(f('decimal'), ' 2.5 ')).toEqual({ ok: true, value: '2.5' });
    expect(parseEditValue(f('integer'), '12')).toEqual({ ok: true, value: '12' });
    expect(parseEditValue(f('percent'), '15%')).toEqual({ ok: true, value: '0.15' });
    expect(parseEditValue(f('money'), '(5.00)')).toEqual({ ok: true, value: '-5.00' });
  });

  it('explains what is wrong in plain words', () => {
    expect(parseEditValue(f('decimal'), 'lots')).toEqual({
      ok: false,
      error: 'Quantity must be a number.',
    });
    expect(parseEditValue(f('integer'), '2.5')).toEqual({
      ok: false,
      error: 'Quantity must be a whole number.',
    });
    expect(parseEditValue(f('money'), '1.23456')).toEqual({
      ok: false,
      error: 'Quantity can have at most 4 decimal places.',
    });
    expect(parseEditValue(f('date', { label: 'Payment due' }), '2026-02-30')).toEqual({
      ok: false,
      error: 'Payment due must be a real date.',
    });
    expect(parseEditValue(f('text', { label: 'Name', required: true }), '  ')).toEqual({
      ok: false,
      error: 'Name can’t be blank.',
    });
  });

  it('keeps allowed values to the list', () => {
    const status = f('text', { label: 'Status', allowedValues: ['completed', 'cancelled'] });
    expect(parseEditValue(status, 'Cancelled')).toEqual({ ok: true, value: 'cancelled' });
    expect(parseEditValue(status, 'lost')).toEqual({
      ok: false,
      error: 'Status must be one of: completed, cancelled.',
    });
  });

  it('reads dates, times and yes/no', () => {
    expect(parseEditValue(f('date'), '2026-03-01')).toEqual({ ok: true, value: '2026-03-01' });
    expect(parseEditValue(f('datetime'), '2026-03-01T09:30')).toEqual({
      ok: true,
      value: '2026-03-01T09:30:00',
    });
    expect(parseEditValue(f('boolean'), true)).toEqual({ ok: true, value: true });
    expect(parseEditValue(f('boolean'), 'no')).toEqual({ ok: true, value: false });
  });

  it('allows blanks for optional details, and links by record number', () => {
    expect(parseEditValue(f('money'), '')).toEqual({ ok: true, value: null });
    expect(parseEditValue(f('reference', { references: 'customer' }), '42')).toEqual({
      ok: true,
      value: '42',
    });
    expect(parseEditValue(f('reference', { references: 'customer' }), 'Bloom')).toMatchObject({
      ok: false,
    });
  });
});

describe('titleFieldOf', () => {
  it('names records by their name, else their code, else nothing', () => {
    const base = { required: false, pii: false };
    expect(
      titleFieldOf([
        { ...base, key: 'sku', label: 'Code', type: 'text', semantic: 'identifier' },
        { ...base, key: 'name', label: 'Name', type: 'text', semantic: 'name' },
      ]),
    ).toBe('name');
    expect(
      titleFieldOf([
        { ...base, key: 'sale_date', label: 'Date', type: 'datetime' },
        {
          ...base,
          key: 'order_number',
          label: 'Order number',
          type: 'text',
          semantic: 'identifier',
        },
      ]),
    ).toBe('order_number');
    expect(
      titleFieldOf([
        { ...base, key: 'contact', label: 'Contact', type: 'text', semantic: 'name', pii: true },
      ]),
    ).toBeUndefined();
  });
});
