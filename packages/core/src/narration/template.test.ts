import { describe, expect, it } from 'vitest';

import { findJargon } from './jargon';
import { renderTemplate, segmentsToText, validateTemplate, type Facts } from './template';

const facts: Facts = {
  product_count: { kind: 'count', value: 412, one: 'product', other: 'products' },
  customer_count: { kind: 'count', value: 1, one: 'customer', other: 'customers' },
  revenue: { kind: 'money', value: '12345.6789' },
  share: { kind: 'percent', value: 0.2361 },
  top_product: { kind: 'text', value: 'Sage Mug' },
};
const opts = { locale: 'en-US', currency: 'USD' };

describe('validateTemplate', () => {
  const allowed = Object.keys(facts);

  it('accepts placeholder-only numbers', () => {
    expect(validateTemplate('We found {{product_count}} and {{customer_count}}.', allowed)).toEqual(
      [],
    );
  });

  it('rejects digits the model wrote itself', () => {
    expect(validateTemplate('We found 412 products.', allowed)).toContain(
      'the text contains a number outside a placeholder',
    );
    expect(validateTemplate('Sales rose by ٣ times.', allowed)).toHaveLength(1);
  });

  it('rejects unknown and malformed placeholders', () => {
    expect(validateTemplate('We found {{order_count}}.', allowed)).toEqual([
      'unknown placeholder {{order_count}}',
    ]);
    expect(validateTemplate('We found {product_count}.', allowed)).toEqual([
      'a placeholder is malformed (use {{name}})',
    ]);
  });

  it('rejects jargon and markup', () => {
    expect(validateTemplate('We loaded {{product_count}} rows into a table.', allowed)).toEqual([
      'the text uses technical words: table, row',
    ]);
    expect(validateTemplate('<b>Hi</b>', allowed)).toEqual(['the text contains markup']);
  });

  it('rejects empty and overlong text', () => {
    expect(validateTemplate('  ', allowed)).toEqual(['the text is empty']);
    expect(validateTemplate('a'.repeat(700), allowed)[0]).toMatch(/longer than/);
  });
});

describe('renderTemplate', () => {
  it('fills placeholders from facts with formatting', () => {
    const segments = renderTemplate(
      'We found {{product_count}} and {{customer_count}}. Revenue {{revenue}} ({{share}}), led by {{top_product}}.',
      facts,
      opts,
    );
    expect(segmentsToText(segments)).toBe(
      'We found 412 products and 1 customer. Revenue $12,345.68 (23.6%), led by Sage Mug.',
    );
    expect(segments.filter((s) => s.fact).map((s) => s.fact)).toEqual([
      'product_count',
      'customer_count',
      'revenue',
      'share',
      'top_product',
    ]);
  });

  it('throws on a missing fact', () => {
    expect(() => renderTemplate('{{nope}}', facts, opts)).toThrow(/nope/);
  });
});

describe('findJargon', () => {
  it('ignores the user’s own quoted names', () => {
    expect(findJargon('We read your “Stock table” sheet.')).toEqual([]);
    expect(findJargon('Each column became a field.')).toEqual(['column', 'field']);
    expect(findJargon('We will dedupe the customers')).toEqual(['dedupe']);
  });
});
