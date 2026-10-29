import type { Language } from '@bizr/i18n';

/**
 * Time ranges in questions ("last month", "this quarter"). The AI picks a preset; code turns it into
 * exact dates in the workspace's calendar, so dates are never guessed. Ranges are [from, to).
 */

export const timePresets = [
  'today',
  'yesterday',
  'last_7_days',
  'last_28_days',
  'last_30_days',
  'last_90_days',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
  'all_time',
] as const;
export type TimePreset = (typeof timePresets)[number];

export interface Calendar {
  /** YYYY-MM-DD in the workspace time zone. */
  today: string;
  /** ISO weekday, 1 = Monday. */
  weekStart: number;
  fiscalYearStartMonth: number;
}

export interface Period {
  from: string;
  to: string;
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

/** Spanish month names (M20): lower case, as Spanish writes them. */
export const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** Short month names by language: "Sep", "sep". */
export function shortMonth(i: number, lang: Language = 'en'): string {
  const m = ((i % 12) + 12) % 12;
  return lang === 'es' ? MESES[m]!.slice(0, 3) : MONTHS[m]!.slice(0, 3);
}

function parts(iso: string): [number, number, number] {
  return iso.split('-').map(Number) as [number, number, number];
}
function iso(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}
export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date);
  return iso(y, m, d + days);
}
function addMonths(date: string, months: number): string {
  const [y, m] = parts(date);
  return iso(y, m + months, 1);
}

/** First day of the fiscal year containing `date`. */
function fiscalYearStart(date: string, startMonth: number): string {
  const [y, m] = parts(date);
  return iso(m >= startMonth ? y : y - 1, startMonth, 1);
}

/** First day of the (fiscal) quarter containing `date`. */
function quarterStart(date: string, startMonth: number): string {
  const [y, m] = parts(date);
  const offset = (m - startMonth + 12) % 12;
  return iso(y, m - (offset % 3), 1);
}

/** The period for a preset; `undefined` for all time. */
export function resolvePreset(preset: TimePreset, cal: Calendar): Period | undefined {
  const t = cal.today;
  const tomorrow = addDays(t, 1);
  const [y, m, d] = parts(t);
  switch (preset) {
    case 'today':
      return { from: t, to: tomorrow };
    case 'yesterday':
      return { from: addDays(t, -1), to: t };
    case 'last_7_days':
      return { from: addDays(t, -6), to: tomorrow };
    case 'last_28_days':
      return { from: addDays(t, -27), to: tomorrow };
    case 'last_30_days':
      return { from: addDays(t, -29), to: tomorrow };
    case 'last_90_days':
      return { from: addDays(t, -89), to: tomorrow };
    case 'this_week':
    case 'last_week': {
      const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
      const start = addDays(t, -((weekday - cal.weekStart + 7) % 7));
      return preset === 'this_week'
        ? { from: start, to: tomorrow }
        : { from: addDays(start, -7), to: start };
    }
    case 'this_month':
      return { from: iso(y, m, 1), to: tomorrow };
    case 'last_month':
      return { from: addMonths(t, -1), to: iso(y, m, 1) };
    case 'this_quarter':
      return { from: quarterStart(t, cal.fiscalYearStartMonth), to: tomorrow };
    case 'last_quarter': {
      const start = quarterStart(t, cal.fiscalYearStartMonth);
      return { from: addMonths(start, -3), to: start };
    }
    case 'this_year':
      return { from: fiscalYearStart(t, cal.fiscalYearStartMonth), to: tomorrow };
    case 'last_year': {
      const start = fiscalYearStart(t, cal.fiscalYearStartMonth);
      return { from: addMonths(start, -12), to: start };
    }
    case 'all_time':
      return undefined;
  }
}

/** The most recent whole calendar month with this name (this year if it has started, else last). */
export function namedMonth(month: number, cal: Calendar, year?: number): Period {
  const [ty, tm] = parts(cal.today);
  const y = year ?? (month <= tm ? ty : ty - 1);
  return { from: iso(y, month, 1), to: iso(y, month + 1, 1) };
}

export function monthIndex(name: string): number | undefined {
  const n = name.toLowerCase().slice(0, 3);
  const i = MONTHS.findIndex((m) => m.toLowerCase().startsWith(n));
  if (i !== -1) return i + 1;
  // Spanish ("ene", "abr", "ago", "dic"; "setiembre" too).
  const e = MESES.findIndex((m) => m.startsWith(n === 'set' ? 'sep' : n));
  return e === -1 ? undefined : e + 1;
}

const fmtDay = (date: string, lang: Language = 'en') => {
  const [y, m, d] = parts(date);
  return `${d} ${shortMonth(m - 1, lang)} ${y}`;
};

/**
 * "September 2026", "2026", "1 Sep 2026 – 7 Sep 2026", "all time"; in Spanish "septiembre de 2026",
 * "1 sep 2026 – 7 sep 2026", "todo el tiempo".
 */
export function periodLabel(p: Period | undefined, lang: Language = 'en'): string {
  if (!p) return lang === 'es' ? 'todo el tiempo' : 'all time';
  const [fy, fm, fd] = parts(p.from);
  const [ty, tm, td] = parts(p.to);
  if (fd === 1 && td === 1) {
    const months = (ty - fy) * 12 + (tm - fm);
    if (months === 1)
      return lang === 'es' ? `${MESES[fm - 1]} de ${fy}` : `${MONTHS[fm - 1]} ${fy}`;
    if (months === 12 && fm === 1) return String(fy);
    if (months === 3) return `${shortMonth(fm - 1, lang)}–${shortMonth(fm + 1, lang)} ${fy}`;
  }
  const last = addDays(p.to, -1);
  return last === p.from ? fmtDay(p.from, lang) : `${fmtDay(p.from, lang)} – ${fmtDay(last, lang)}`;
}
