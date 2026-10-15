import { describe, expect, it } from 'vitest';

import { safeNextPath } from './redirects';

describe('safeNextPath', () => {
  it('allows site paths', () => {
    expect(safeNextPath('/w/shop-1234/home')).toBe('/w/shop-1234/home');
    expect(safeNextPath('/onboarding?x=1')).toBe('/onboarding?x=1');
  });

  it.each(['https://evil.example', '//evil.example', '/\\evil.example', 'evil', '', '/a\nb'])(
    'rejects %j',
    (value) => {
      expect(safeNextPath(value)).toBeUndefined();
    },
  );

  it('ignores missing and repeated params', () => {
    expect(safeNextPath(undefined)).toBeUndefined();
    expect(safeNextPath(['/a', '/b'])).toBeUndefined();
  });
});
