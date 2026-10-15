import { describe, expect, it } from 'vitest';

import {
  checkEntityReferences,
  packEntitySchema,
  packFieldSchema,
  type PackEntity,
} from './schema';

const entity = (overrides: Partial<PackEntity>): PackEntity =>
  packEntitySchema.parse({
    id: 'thing',
    label: { singular: 'Thing', plural: 'Things' },
    description: 'A thing.',
    fields: [{ id: 'name', label: 'Name', type: 'text' }],
    ...overrides,
  });

describe('pack field schema', () => {
  it('requires a target for reference fields', () => {
    expect(packFieldSchema.safeParse({ id: 'x', label: 'X', type: 'reference' }).success).toBe(
      false,
    );
  });

  it('only allows allowed_values on text fields', () => {
    const r = packFieldSchema.safeParse({
      id: 'x',
      label: 'X',
      type: 'money',
      allowed_values: ['a'],
    });
    expect(r.success).toBe(false);
  });

  it('defaults required and pii to false', () => {
    expect(packFieldSchema.parse({ id: 'x', label: 'X', type: 'text' })).toMatchObject({
      required: false,
      pii: false,
    });
  });
});

describe('checkEntityReferences', () => {
  it('accepts a consistent set', () => {
    const parent = entity({ id: 'parent' });
    const child = entity({
      id: 'child',
      natural_keys: [['parent', 'name']],
      fields: [
        { id: 'name', label: 'Name', type: 'text', required: false, pii: false },
        {
          id: 'parent',
          label: 'Parent',
          type: 'reference',
          references: 'parent',
          required: false,
          pii: false,
        },
      ],
    });
    expect(checkEntityReferences([parent, child])).toEqual([]);
  });

  it('reports unknown references, keys and time fields, and duplicates', () => {
    const bad = entity({
      id: 'bad',
      natural_keys: [['missing']],
      time_field: 'name',
      fields: [
        { id: 'name', label: 'Name', type: 'text', required: false, pii: false },
        { id: 'name', label: 'Dup', type: 'text', required: false, pii: false },
        {
          id: 'owner',
          label: 'Owner',
          type: 'reference',
          references: 'nobody',
          required: false,
          pii: false,
        },
      ],
    });
    const problems = checkEntityReferences([bad, bad]).join('\n');
    expect(problems).toContain('entity "bad" is defined twice');
    expect(problems).toContain('bad.name is defined twice');
    expect(problems).toContain('unknown entity "nobody"');
    expect(problems).toContain('unknown field "missing"');
    expect(problems).toContain('must be a date or datetime');
  });
});
