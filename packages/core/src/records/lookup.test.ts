import { describe, expect, it } from 'vitest';

import { bestMatches, matchScore } from './lookup';

const products = [
  { id: '1', title: 'Sage Stoneware Mug' },
  { id: '2', title: 'Blush Stoneware Mug' },
  { id: '3', title: 'Sage Ceramic Plant Pot' },
  { id: '4', title: 'Amber Wood Candle Small' },
  { id: '5', title: 'Amber Wood Candle Large' },
  { id: '6', title: 'Birthday Card Cake', also: ['FW-CRD-002'] },
];

describe('matchScore', () => {
  it('needs every typed word, ignoring case and plurals', () => {
    expect(matchScore('Sage mugs', 'Sage Stoneware Mug')).toBeGreaterThan(0.5);
    expect(matchScore('sage stoneware mug', 'Sage Stoneware Mug')).toBe(1);
    expect(matchScore('green mug', 'Sage Stoneware Mug')).toBe(0);
    expect(matchScore('candles', 'Amber Wood Candle Small')).toBeGreaterThan(0);
  });
});

describe('bestMatches', () => {
  it('finds the one meant, or lists the close ones', () => {
    expect(bestMatches('Sage mugs', products).map((c) => c.id)).toEqual(['1']);
    expect(
      bestMatches('amber candle', products)
        .map((c) => c.id)
        .sort(),
    ).toEqual(['4', '5']);
    expect(bestMatches('Sage Stoneware Mug', products)).toHaveLength(1);
    expect(bestMatches('fw-crd-002', products).map((c) => c.id)).toEqual(['6']);
    expect(bestMatches('teapot', products)).toEqual([]);
  });
});
