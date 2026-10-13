import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineJob, JobRegistry } from './define';

const step = (name: string) => ({ name, run: async ({ state }: { state: object }) => ({ state }) });

describe('defineJob', () => {
  it('rejects a job with no steps', () => {
    expect(() =>
      defineJob({ name: 'x.empty', input: z.object({}), initialState: () => ({}), steps: [] }),
    ).toThrow(/no steps/);
  });

  it('rejects duplicate step names', () => {
    expect(() =>
      defineJob({
        name: 'x.dup',
        input: z.object({}),
        initialState: () => ({}),
        steps: [step('a'), step('a')],
      }),
    ).toThrow(/duplicate step/);
  });
});

describe('JobRegistry', () => {
  const a = defineJob({
    name: 'x.a',
    input: z.object({}),
    initialState: () => ({}),
    steps: [step('s')],
  });

  it('looks up jobs by name', () => {
    const registry = new JobRegistry([a]);
    expect(registry.get('x.a')).toBe(a);
    expect(registry.names()).toEqual(['x.a']);
  });

  it('throws on unknown or duplicate names', () => {
    expect(() => new JobRegistry([a]).get('nope')).toThrow(/Unknown job/);
    expect(() => new JobRegistry([a, a])).toThrow(/Duplicate job/);
  });
});
