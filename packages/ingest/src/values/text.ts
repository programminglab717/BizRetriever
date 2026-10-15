/** Helpers for untrusted text from uploaded files (AI_DESIGN §2). */

// Control characters, zero-width and bidi-override characters (stripping them is the point).
/* eslint-disable no-control-regex */
const UNSAFE =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;
/* eslint-enable no-control-regex */

/** Removes control/zero-width characters, collapses whitespace and truncates. */
export function sanitizeText(value: string, maxLength = 80): string {
  const clean = value.replace(UNSAFE, '').replace(/\s+/g, ' ').trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean;
}

// "Co" is deliberately not here: it is usually part of the name ("Bloom & Co").
const LEGAL_SUFFIXES = /\s(ltd|limited|llc|inc|incorporated|corp|corporation|plc|gmbh|pty)$/;

/**
 * Normalised key for matching names that are "the same thing spelled differently":
 * "Bloom & Co", "Bloom and Co.", "BLOOM & CO LTD" → "bloom and co".
 */
export function normalizeKey(value: string): string {
  let s = value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const stripped = s.replace(LEGAL_SUFFIXES, '').trim();
  return (stripped || s).replace(/\s+/g, ' ');
}

/** Shape of an identifier-like value: letters → A, digits → 9, other characters kept ("FW-MUG-001" → "AA-AAA-999"). */
export function valueShape(value: string): string {
  return value.length > 30 ? '(long text)' : value.replace(/[A-Za-z]/g, 'A').replace(/\d/g, '9');
}

export const NULL_SENTINELS = new Set([
  '-',
  '–',
  '—',
  'n/a',
  'na',
  'none',
  'null',
  'tbc',
  'tba',
  '?',
  '??',
  '#n/a',
  'n.a.',
  'nil',
]);

export function isNullSentinel(value: string): boolean {
  return NULL_SENTINELS.has(value.trim().toLowerCase());
}

/**
 * Lighter normalisation for matching records on their natural keys: case, punctuation, "&"/"and"
 * and accents only. Unlike `normalizeKey` it keeps legal suffixes, so "Acme Ltd" and "Acme" stay
 * different unless the owner confirms they are the same (dedupe).
 */
export function normalizeLoose(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
