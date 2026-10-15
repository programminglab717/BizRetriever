import { describe, expect, it } from 'vitest';

import { detectPii, maskIfPii, maskPii } from './pii';
import { normalizeKey, sanitizeText, valueShape } from './text';

describe('PII', () => {
  it('detects and masks emails, phones and cards while keeping their shape', () => {
    expect(detectPii('olivia.smith@gmail.com')).toBe('email');
    expect(maskPii('olivia.smith@gmail.com', 'email')).toBe('o***@g***.com');
    expect(detectPii('+1 (503) 555-0142')).toBe('phone');
    expect(maskPii('+1 (503) 555-0142', 'phone')).toBe('+* (***) ***-**42');
    expect(detectPii('4111 1111 1111 1111')).toBe('card');
    expect(maskPii('4111 1111 1111 1111', 'card')).toBe('•••• 1111');
  });

  it('leaves ordinary values alone', () => {
    for (const v of [
      'Sage Stoneware Mug',
      '18.00',
      '2026-03-04',
      'FW-MUG-001',
      '12 pcs',
      'R50001',
    ]) {
      expect(detectPii(v)).toBeUndefined();
      expect(maskIfPii(v)).toBe(v);
    }
  });
});

describe('text helpers', () => {
  it('normalises name variants to one key', () => {
    expect(normalizeKey('Bloom & Co')).toBe('bloom and co');
    expect(normalizeKey('Bloom and Co.')).toBe('bloom and co');
    expect(normalizeKey('BLOOM & CO LTD')).toBe('bloom and co');
    expect(normalizeKey('Juniper House Inc')).toBe('juniper house');
    expect(normalizeKey('Café Olé')).toBe('cafe ole');
  });

  it('sanitises untrusted text', () => {
    expect(sanitizeText('a​b\u0000c‮  d\n\te')).toBe('abc d e');
    expect(sanitizeText('x'.repeat(100), 10)).toBe('xxxxxxxxx…');
  });

  it('describes value shapes', () => {
    expect(valueShape('FW-MUG-001')).toBe('AA-AAA-999');
  });
});
