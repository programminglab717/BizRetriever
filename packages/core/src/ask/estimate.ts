import type { AskCatalog } from './catalog';
import { normalizeQuestion } from './rules';

/**
 * Questions about what's ahead (M12, ADR-061), recognised by rules before interpretation: an
 * estimate for a planning measure over a coming period, goal progress, or what to reorder. The AI's
 * interpretation schema doesn't change; these never reach it. Anything that also reads as a
 * question about the past ("did", "last", "so far") is left to the normal interpretation.
 */

export type EstimateRequest =
  | { kind: 'forecast'; metric: string; period: { from: string; to: string }; label: string }
  | { kind: 'goal'; metric: string | null }
  | { kind: 'reorder' }
  /** A coming period for a measure we can't estimate (a margin, a stock level). */
  | { kind: 'not_estimable'; metric: string };

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const SHORT_MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
const label = (m: number) => `${MONTHS[m]![0]!.toUpperCase()}${MONTHS[m]!.slice(1)}`;

const PAST = / (did|was|were|had|last|ago|yesterday|so far|previous|previously|used to) /;
const FUTURE_VERB =
  / (will|going to|gonna|forecast|forecasts|predict|prediction|projected|projection|project|expect|expected|expecting|estimate|estimated|likely) /;
const REORDER =
  / (re ?order|reorders|re-order|restock|restocking)| (need|should|have) to (order|buy)| should (i|we) (order|buy)| what to (order|buy)/;
const GOAL = / (goal|goals|target|targets) /;
const GOAL_CUE =
  / (on track|on pace|hit|reach|make|meet|beat|going|progress|doing|will|am i|are we) /;

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
function addMonths(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
const monthStart = (iso: string) => `${iso.slice(0, 8)}01`;

/** The longest measure name (label or synonym) in the question, as whole words. */
function mentionedMetric(text: string, catalog: AskCatalog): string | null {
  const phrases = catalog.metrics
    .flatMap((m) => [m.label, ...m.synonyms].map((p) => ({ id: m.id, p: normalizeQuestion(p) })))
    .filter((x) => x.p.trim().length >= 3)
    .sort((a, b) => b.p.length - a.p.length);
  return phrases.find((x) => text.includes(x.p))?.id ?? null;
}

/** A goal's measure by name, or by the pack's everyday words for it ("my order goal"). */
function goalMetric(
  text: string,
  catalog: AskCatalog,
  goals: readonly string[],
  words: Readonly<Record<string, readonly string[]>>,
): string | null {
  const named = mentionedMetric(text, catalog);
  if (named && goals.includes(named)) return named;
  for (const id of goals)
    if ((words[id] ?? []).some((w) => text.includes(` ${normalizeQuestion(w).trim()} `))) return id;
  return null;
}

interface Period {
  from: string;
  to: string;
  label: string;
}

/** A coming period named in the question, if any; `strong` when it alone makes it about the future. */
function comingPeriod(text: string, today: string, weekStart: number, future: boolean) {
  const found = (p: Period, strong: boolean) => ({ ...p, strong });
  if (/ tomorrow /.test(text)) {
    const from = addDays(today, 1);
    return found({ from, to: addDays(from, 1), label: 'tomorrow' }, true);
  }
  const n = / (?:next|coming|following) (\d{1,3}) (day|days|week|weeks|month|months) /.exec(text);
  if (n) {
    const k = Number(n[1]);
    const unit = n[2]!.replace(/s$/, '');
    const to = unit === 'month' ? addMonths(today, k) : addDays(today, unit === 'week' ? k * 7 : k);
    return found({ from: today, to, label: `the next ${k} ${k === 1 ? unit : `${unit}s`}` }, true);
  }
  if (/ (rest|remainder) of (the|this) month | end of (the|this) month /.test(text)) {
    const to = addMonths(monthStart(today), 1);
    return found(
      { from: today, to, label: `the rest of ${label(Number(today.slice(5, 7)) - 1)}` },
      true,
    );
  }
  if (/ next week /.test(text)) {
    const iso = ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const from = addDays(today, (weekStart - iso + 7) % 7 || 7);
    return found({ from, to: addDays(from, 7), label: 'next week' }, true);
  }
  if (/ next month /.test(text)) {
    const from = addMonths(monthStart(today), 1);
    const m = Number(from.slice(5, 7)) - 1;
    return found({ from, to: addMonths(from, 1), label: `${label(m)} ${from.slice(0, 4)}` }, true);
  }
  if (/ (coming|upcoming) (week|weeks) /.test(text))
    return found({ from: today, to: addDays(today, 7), label: 'the next 7 days' }, true);
  if (/ (coming|upcoming) (month|months) /.test(text))
    return found({ from: today, to: addDays(today, 30), label: 'the next 30 days' }, true);
  if (!future) return null;
  if (/ this month /.test(text)) {
    const from = monthStart(today);
    const m = Number(from.slice(5, 7)) - 1;
    return found({ from, to: addMonths(from, 1), label: `${label(m)} ${from.slice(0, 4)}` }, false);
  }
  if (/ this week /.test(text)) {
    const iso = ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const from = addDays(today, -((iso - weekStart + 7) % 7));
    return found({ from, to: addDays(from, 7), label: 'this week' }, false);
  }
  const named = new RegExp(
    ` (?:in |for |during )?(${[...MONTHS, ...Object.keys(SHORT_MONTHS)].join('|')})(?: (20\\d\\d))? `,
  ).exec(text);
  if (named) {
    const word = named[1]!;
    const m = MONTHS.includes(word) ? MONTHS.indexOf(word) : SHORT_MONTHS[word]!;
    const current = Number(today.slice(5, 7)) - 1;
    const year = named[2] ? Number(named[2]) : Number(today.slice(0, 4)) + (m < current ? 1 : 0);
    const from = `${year}-${String(m + 1).padStart(2, '0')}-01`;
    // A month already over isn't ahead.
    if (addMonths(from, 1) <= today) return null;
    return found({ from, to: addMonths(from, 1), label: `${label(m)} ${year}` }, false);
  }
  return null;
}

export function estimateRequestWithRules(
  question: string,
  catalog: AskCatalog,
  planning: {
    forecasts: readonly string[];
    goals: readonly string[];
    goalWords?: Readonly<Record<string, readonly string[]>>;
  },
): EstimateRequest | null {
  const text = normalizeQuestion(question);
  if (PAST.test(text)) return null;
  if (REORDER.test(text) || / reorder list /.test(text)) return { kind: 'reorder' };
  if (GOAL.test(text) && GOAL_CUE.test(text))
    return {
      kind: 'goal',
      metric: goalMetric(text, catalog, planning.goals, planning.goalWords ?? {}),
    };

  const future = FUTURE_VERB.test(text);
  const { today, weekStart } = catalog.calendar;
  const period = comingPeriod(text, today, weekStart, future);
  if (!period && !future) return null;
  const metric = mentionedMetric(text, catalog);
  const plannable = [...planning.forecasts, ...planning.goals];
  if (!metric) return null;
  // A period found here is ahead by construction (named months only count with a future word).
  if (!plannable.includes(metric)) return period ? { kind: 'not_estimable', metric } : null;
  const p = period ?? { from: today, to: addDays(today, 30), label: 'the next 30 days' };
  return { kind: 'forecast', metric, period: { from: p.from, to: p.to }, label: p.label };
}
