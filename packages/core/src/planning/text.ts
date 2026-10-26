import type { MetricFormat } from '@bizr/packs';

import type { ForecastNote } from './forecast';
import type { GoalProgress } from './goals';

/**
 * How estimates read (ADR-060). Estimates are rounded to three significant figures and always say
 * "about": they aren't records. Recorded numbers (this month so far, the goal) are shown exactly.
 */

export interface EstimateStyle {
  locale: string;
  currency: string;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = [
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
  'Sundays',
];

export function roundEstimate(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 100) return Math.round(n);
  const step = 10 ** (Math.floor(Math.log10(n)) - 2);
  return Math.round(n / step) * step;
}

export function formatEstimate(n: number, format: MetricFormat, o: EstimateStyle): string {
  const v = roundEstimate(n);
  return format === 'money'
    ? new Intl.NumberFormat(o.locale, {
        style: 'currency',
        currency: o.currency,
        maximumFractionDigits: 0,
      }).format(v)
    : new Intl.NumberFormat(o.locale, { maximumFractionDigits: 0 }).format(v);
}

/** A recorded value (exact), as the rest of the app shows it. */
export function formatExact(v: string | number, format: MetricFormat, o: EstimateStyle): string {
  return format === 'money'
    ? new Intl.NumberFormat(o.locale, { style: 'currency', currency: o.currency }).format(
        // Intl formats decimal strings exactly; the lib typings lag behind.
        String(v) as unknown as number,
      )
    : new Intl.NumberFormat(o.locale, { maximumFractionDigits: 2 }).format(Number(v));
}

const pct = (x: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(Math.abs(x));

/** One sentence per thing the estimate assumed. */
export function noteText(note: ForecastNote, locale: string): string {
  switch (note.kind) {
    case 'season':
      return `${MONTHS[note.month - 1]} is usually ${pct(note.change, locale)} ${note.change >= 0 ? 'busier' : 'quieter'} than your last 4 weeks.`;
    case 'growth':
      return `Your last 4 weeks were ${pct(note.yearly, locale)} ${note.yearly >= 0 ? 'up' : 'down'} on the same weeks last year, and we expect that to carry on.`;
    case 'no_season':
      return `We don’t know your busy and quiet months yet (${note.historyDays} days of sales so far), so this carries your last 4 weeks forward. With a year of sales it will allow for the season.`;
    case 'weekdays':
      return `${WEEKDAYS[note.busiest]} are your busiest day (${pct(note.change, locale)} above an average day).`;
  }
}

/** "68% of your goal", "Heading for about $11,400 (between $10,600 and $12,200)". */
export function goalLines(g: GoalProgress, o: EstimateStyle) {
  const soFar = `${g.month.label} so far: ${formatExact(g.soFar, g.metric.format, o)} of ${formatExact(g.target, g.metric.format, o)} (${pct(g.share, o.locale)}).`;
  const heading = g.projected
    ? `Heading for about ${formatEstimate(g.projected.total, g.metric.format, o)} by the end of the month (likely between ${formatEstimate(g.projected.low, g.metric.format, o)} and ${formatEstimate(g.projected.high, g.metric.format, o)}).`
    : null;
  const need =
    g.status === 'reached'
      ? 'Goal reached. Well done.'
      : g.daysLeft > 0
        ? `To reach it: about ${formatEstimate(g.perDayNeeded, g.metric.format, o)} a day for the ${g.daysLeft === 1 ? 'last day' : `last ${g.daysLeft} days`}.`
        : null;
  return { soFar, heading, need };
}

export const STATUS_LABEL: Record<GoalProgress['status'], string> = {
  reached: 'Reached',
  ahead: 'Ahead',
  on_track: 'On track',
  behind: 'Behind',
  unknown: 'Too early to say',
};
