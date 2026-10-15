import { describe, expect, it } from 'vitest';

import { workspaceSlug } from './slug';

describe('workspaceSlug', () => {
  it('makes a readable, URL-safe slug with a random suffix', () => {
    expect(workspaceSlug('Fernwood Home & Gift')).toMatch(/^fernwood-home-and-gift-[0-9a-f]{4}$/);
    expect(workspaceSlug('Café Olé!!')).toMatch(/^cafe-ole-[0-9a-f]{4}$/);
  });

  it('falls back when the name has no usable characters', () => {
    expect(workspaceSlug('★★★')).toMatch(/^business-[0-9a-f]{4}$/);
  });

  it('is never longer than 45 characters', () => {
    expect(workspaceSlug('x'.repeat(200)).length).toBeLessThanOrEqual(45);
  });
});
