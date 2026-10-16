import { normalizeLoose } from '@bizr/ingest';

/**
 * Finding the records someone names (Task H lookups, and links between imported records): "Sage
 * mugs" → Sage Stoneware Mug. Pure scoring; callers fetch the names. Words are compared loosely
 * (case, punctuation, simple plurals, common shop abbreviations), and every word written has to be
 * found.
 */

const STOP = new Set(['the', 'a', 'an', 'of', 'my', 'our']);

const stem = (w: string) =>
  w.length > 3 && w.endsWith('ies')
    ? `${w.slice(0, -3)}y`
    : w.length > 3 && /(ches|shes|xes|ses)$/.test(w)
      ? w.slice(0, -2)
      : w.length > 2 && w.endsWith('s') && !w.endsWith('ss')
        ? w.slice(0, -1)
        : w;

/** How tills and spreadsheets shorten words ("Candle Sml"). */
const ABBREVIATIONS: Record<string, string> = {
  sml: 'small',
  sm: 'small',
  med: 'medium',
  md: 'medium',
  lrg: 'large',
  lg: 'large',
  pk: 'pack',
  pr: 'pair',
  asst: 'assorted',
};

export const words = (s: string) =>
  normalizeLoose(s)
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map((w) => ABBREVIATIONS[w] ?? w)
    .map(stem);

/** 0…1: how well `mention` names `title`. 1 is an exact match (ignoring case and plurals). */
export function matchScore(mention: string, title: string): number {
  const m = words(mention);
  const t = words(title);
  if (m.length === 0 || t.length === 0) return 0;
  if (m.join(' ') === t.join(' ')) return 1;
  const found = m.filter((w) =>
    t.some((x) => x === w || (w.length >= 4 && x.startsWith(w))),
  ).length;
  if (found < m.length) return 0;
  // All typed words found: prefer titles with fewer extra words.
  return 0.5 + 0.49 * (m.length / t.length);
}

export interface Candidate {
  id: string;
  title: string;
  score: number;
}

/** The best matches, best first. A clear winner (exact, or far ahead) comes back alone. */
export function bestMatches(
  mention: string,
  rows: readonly { id: string; title: string; also?: readonly string[] }[],
  limit = 5,
): Candidate[] {
  const scored = rows
    .map((r) => ({
      id: r.id,
      title: r.title,
      score: Math.max(
        matchScore(mention, r.title),
        ...(r.also ?? []).map((a) => (normalizeLoose(a) === normalizeLoose(mention) ? 1 : 0)),
      ),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  if (scored[0]?.score === 1 && scored[1]?.score !== 1) return [scored[0]];
  return scored.slice(0, limit);
}
