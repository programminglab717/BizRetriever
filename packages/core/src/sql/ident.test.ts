import { describe, expect, it } from 'vitest';

import { ident, isSafeIdentifier, qualified, UnsafeIdentifierError } from './ident';

describe('ident', () => {
  it('quotes safe snake_case names', () => {
    expect(ident('sale_lines')).toBe('"sale_lines"');
    expect(ident('_id')).toBe('"_id"');
    expect(qualified('t_abc1234567', 'products')).toBe('"t_abc1234567"."products"');
  });

  it.each([
    'Products',
    'sale lines',
    'x"; drop table y; --',
    '1abc',
    '',
    'a'.repeat(64),
    'café',
    'a-b',
    'a.b',
    "a'b",
    'a\u0000b',
  ])('rejects %j', (name) => {
    expect(isSafeIdentifier(name)).toBe(false);
    expect(() => ident(name)).toThrow(UnsafeIdentifierError);
  });

  it('accepts the 63-character maximum', () => {
    expect(isSafeIdentifier('a'.repeat(63))).toBe(true);
  });
});
