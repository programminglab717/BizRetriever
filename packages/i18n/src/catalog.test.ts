import { describe, expect, it } from 'vitest';

import { parts } from './es';
import { placeholders } from './translate';

/** Words the copy guidelines keep out of what people read (PRODUCT_SPEC), in Spanish. */
const JARGON = /\b(esquema|tablas?|consultas?|SQL|clave foránea|nulos?|join)\b/i;

describe('Spanish catalog', () => {
  const entries = Object.entries(parts).flatMap(([part, c]) =>
    Object.entries(c).map(([from, to]) => ({ part, from, to })),
  );

  it('keeps every placeholder of the English text', () => {
    const bad = entries.filter((e) => placeholders(e.from).join() !== placeholders(e.to).join());
    expect(bad.map((e) => `${e.part}: ${e.from}`)).toEqual([]);
  });

  it('has no empty translations', () => {
    expect(entries.filter((e) => !e.to.trim()).map((e) => e.from)).toEqual([]);
  });

  it('translates a phrase the same way wherever it appears', () => {
    const seen = new Map<string, { part: string; to: string }>();
    const clashes: string[] = [];
    for (const e of entries) {
      const prev = seen.get(e.from);
      if (prev && prev.to !== e.to) clashes.push(`${e.from} (${prev.part} vs ${e.part})`);
      seen.set(e.from, e);
    }
    expect(clashes).toEqual([]);
  });

  it('uses no jargon', () => {
    expect(entries.filter((e) => JARGON.test(e.to)).map((e) => `${e.part}: ${e.to}`)).toEqual([]);
  });
});
