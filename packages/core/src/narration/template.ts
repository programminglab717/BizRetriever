import { findJargon } from './jargon';

/**
 * Placeholder narration (ADR-009). The AI writes short text with `{{fact_name}}` placeholders and no
 * numbers of its own; code fills the placeholders from computed facts. So every number the user sees
 * comes from code, never from the model.
 */

export type Fact =
  /** A count with its noun: `{{product_count}}` → "412 products". */
  | { kind: 'count'; value: number; one: string; other: string }
  | { kind: 'number'; value: number }
  /** Decimal string (never a float), formatted in the workspace currency. */
  | { kind: 'money'; value: string }
  /** A fraction: 0.123 → "12.3%". */
  | { kind: 'percent'; value: number }
  /** Text from the user's data, e.g. a product name. Shown as-is. */
  | { kind: 'text'; value: string };

export type Facts = Record<string, Fact>;

export interface Segment {
  text: string;
  /** Set when this segment was filled from a fact (the UI shows these in bold). */
  fact?: string;
}

export interface FormatOptions {
  locale: string;
  currency: string;
}

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]{0,60})\s*\}\}/g;
export const MAX_TEMPLATE_LENGTH = 600;

export function placeholdersIn(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1]!);
}

/**
 * Problems with a template, in plain English for logs and repair prompts. Empty means it's safe to
 * render: every placeholder is a known fact, there are no digits outside placeholders, no jargon and
 * no markup.
 */
export function validateTemplate(template: string, allowed: Iterable<string>): string[] {
  const problems: string[] = [];
  const known = new Set(allowed);
  if (template.trim() === '') problems.push('the text is empty');
  if (template.length > MAX_TEMPLATE_LENGTH)
    problems.push(`the text is longer than ${MAX_TEMPLATE_LENGTH} characters`);
  for (const name of placeholdersIn(template)) {
    if (!known.has(name)) problems.push(`unknown placeholder {{${name}}}`);
  }
  const rest = template.replace(PLACEHOLDER, ' ');
  if (/[{}]/.test(rest)) problems.push('a placeholder is malformed (use {{name}})');
  if (/\p{Nd}/u.test(rest)) problems.push('the text contains a number outside a placeholder');
  if (/[<>]/.test(rest)) problems.push('the text contains markup');
  const jargon = findJargon(rest);
  if (jargon.length > 0) problems.push(`the text uses technical words: ${jargon.join(', ')}`);
  return problems;
}

export function formatFact(fact: Fact, options: FormatOptions): string {
  const n = (v: number, o?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat(options.locale, o).format(v);
  switch (fact.kind) {
    case 'count':
      return `${n(fact.value)} ${fact.value === 1 ? fact.one : fact.other}`;
    case 'number':
      return n(fact.value, { maximumFractionDigits: 2 });
    case 'money':
      // Intl formats decimal strings exactly (no float conversion); the lib typings lag behind.
      return new Intl.NumberFormat(options.locale, {
        style: 'currency',
        currency: options.currency,
      }).format(fact.value as unknown as number);
    case 'percent':
      return n(fact.value, { style: 'percent', maximumFractionDigits: 1 });
    case 'text':
      return fact.value;
  }
}

/** Fill a validated template. Throws on unknown placeholders (validate first). */
export function renderTemplate(template: string, facts: Facts, options: FormatOptions): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of template.matchAll(PLACEHOLDER)) {
    const name = m[1]!;
    const fact = facts[name];
    if (!fact) throw new Error(`No fact for placeholder {{${name}}}`);
    if (m.index > last) out.push({ text: template.slice(last, m.index) });
    out.push({ text: formatFact(fact, options), fact: name });
    last = m.index + m[0].length;
  }
  if (last < template.length) out.push({ text: template.slice(last) });
  return out;
}

export function segmentsToText(segments: readonly Segment[]): string {
  return segments.map((s) => s.text).join('');
}
