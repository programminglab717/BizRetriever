import type { FactValue } from './evaluate';

/**
 * Filling insight sentences (AI_DESIGN §7, step 4). Templates are trusted pack text (or a Task J
 * phrasing that passed validation): `{{fact}}` is replaced by the formatted fact, `{{n|one|many}}`
 * picks a word by the fact n, and `**…**` marks bold. Code fills every number.
 */

export interface InsightSegment {
  text: string;
  bold?: true;
  /** Set when the text came from a fact. */
  fact?: string;
}

export interface RenderOptions {
  locale: string;
  currency: string;
  /** Words around numbers ("3 days" / "3 días"), M20. */
  lang?: 'en' | 'es';
}

/** `{{name}}` or `{{name|one|many}}`. */
export const INSIGHT_PLACEHOLDER = /\{\{\s*([a-z_][a-z0-9_]*)\s*(?:\|([^|}]*)\|([^|}]*))?\}\}/g;

function rounded(f: FactValue): number {
  if (f.format === 'text') return NaN;
  if (f.format === 'integer' || f.format === 'days') return Math.round(f.value);
  return f.value;
}

export function formatInsightFact(f: FactValue, o: RenderOptions): string {
  const n = (v: number, opts?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat(o.locale, opts).format(Object.is(v, -0) ? 0 : v);
  switch (f.format) {
    case 'text':
      return f.value;
    case 'money':
      // Intl formats decimal strings exactly; the lib typings lag behind.
      return new Intl.NumberFormat(o.locale, { style: 'currency', currency: o.currency }).format(
        (f.exact ?? f.value.toFixed(2)) as unknown as number,
      );
    case 'number':
      return n(f.value, { maximumFractionDigits: 1 });
    case 'integer':
      return n(Math.round(f.value));
    case 'days': {
      const d = Math.round(f.value);
      if (o.lang === 'es') return `${n(d)} ${d === 1 ? 'día' : 'días'}`;
      return `${n(d)} ${d === 1 ? 'day' : 'days'}`;
    }
    case 'percent':
      return n(f.value, { style: 'percent', maximumFractionDigits: 1 });
    case 'points': {
      const p = f.value * 100;
      const word =
        o.lang === 'es'
          ? Math.abs(p) === 1
            ? 'punto'
            : 'puntos'
          : Math.abs(p) === 1
            ? 'point'
            : 'points';
      return `${n(p, { maximumFractionDigits: 1 })} ${word}`;
    }
  }
}

/** Throws on a placeholder without a fact: templates are checked before they get here. */
export function renderInsight(
  template: string,
  facts: Record<string, FactValue>,
  o: RenderOptions,
): InsightSegment[] {
  const out: InsightSegment[] = [];
  const push = (text: string, bold: boolean, fact?: string) => {
    if (!text) return;
    const prev = out.at(-1);
    if (prev && !fact && !prev.fact && Boolean(prev.bold) === bold) {
      prev.text += text;
      return;
    }
    out.push({ text, ...(bold ? { bold: true as const } : {}), ...(fact ? { fact } : {}) });
  };
  template.split('**').forEach((chunk, i) => {
    const bold = i % 2 === 1;
    let last = 0;
    for (const m of chunk.matchAll(INSIGHT_PLACEHOLDER)) {
      const name = m[1]!;
      const f = facts[name];
      if (!f) throw new Error(`No fact for {{${name}}}`);
      push(chunk.slice(last, m.index), bold);
      if (m[2] !== undefined) push(rounded(f) === 1 ? m[2] : m[3]!, bold);
      else push(formatInsightFact(f, o), bold, name);
      last = m.index + m[0].length;
    }
    push(chunk.slice(last), bold);
  });
  return out;
}

export function insightText(segments: readonly InsightSegment[]): string {
  return segments.map((s) => s.text).join('');
}
