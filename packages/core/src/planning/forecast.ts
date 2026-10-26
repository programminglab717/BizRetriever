/**
 * Estimates of the days ahead from a business's own daily history (M11, ADR-060). Pure and
 * deterministic: the same history gives the same estimate.
 *
 * - **With 13 months or more** ("seasonal"): last year's same weeks, scaled by how the last 4
 *   weeks compare with the same weeks a year earlier (season and this year's growth together).
 * - **With a year** ("seasonal"): each month's usual level against the year's average (so November
 *   knows it's busier than October), the weekday pattern from the last 12 weeks, and the current
 *   level from the last 4 weeks with both patterns taken out.
 * - **With less** ("recent"): the last 4 weeks' level and weekday pattern, carried on, with a note
 *   that the season isn't known yet.
 * - **The range** is how far the same method was off on the last few months' 4-week periods.
 *
 * These are estimates, not records: values are plain numbers (callers round money for display).
 */

export interface DayValue {
  date: string;
  value: number;
}

export type ForecastNote =
  /** The window's main month against the last 4 weeks' months: +0.43 is "43% busier". */
  | { kind: 'season'; month: number; change: number }
  | { kind: 'no_season'; historyDays: number }
  /** The last 4 weeks against the same weeks a year earlier (0.25 = 25% up). */
  | { kind: 'growth'; yearly: number }
  /** The busiest weekday (0 = Monday) and how much busier than the average day. */
  | { kind: 'weekdays'; busiest: number; change: number };

export interface Forecast {
  method: 'seasonal' | 'recent';
  historyDays: number;
  days: { date: string; estimate: number }[];
  total: number;
  low: number;
  high: number;
  /** The fraction used for the range (0.12 = ±12%). */
  error: number;
  notes: ForecastNote[];
}

const DAY_MS = 86_400_000;
const MIN_HISTORY = 14;
const YEAR = 365;
const LEVEL_DAYS = 28;
const WEEKDAY_DAYS = 84;

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
const weekdayOf = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
const monthOf = (iso: string) => Number(iso.slice(5, 7));
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Every day from the first one with data to the day before `from`; missing days are 0. */
function dense(history: readonly DayValue[], from: string): DayValue[] {
  const byDay = new Map<string, number>();
  for (const h of history) {
    if (h.date >= from || !Number.isFinite(h.value)) continue;
    byDay.set(h.date, (byDay.get(h.date) ?? 0) + h.value);
  }
  if (byDay.size === 0) return [];
  const first = [...byDay.keys()].sort()[0]!;
  const out: DayValue[] = [];
  for (let d = first; d < from; d = addDays(d, 1)) out.push({ date: d, value: byDay.get(d) ?? 0 });
  return out;
}

interface Core {
  method: Forecast['method'];
  days: { date: string; estimate: number }[];
  notes: ForecastNote[];
}

/** Same weekday a year back (364 days), averaged with the weeks either side to steady it. */
const LAST_YEAR = [371, 364, 357];

/**
 * With 13 months or more: last year's same weeks, scaled by how the last 4 weeks compare with the
 * same 4 weeks a year earlier. Follows both the season and this year's own growth.
 */
function lastYear(days: readonly DayValue[], from: string, horizon: number): Core | null {
  const n = days.length;
  const at = (back: number) => days[n - back]?.value; // `back` days before `from`
  let recent = 0;
  let yearAgo = 0;
  for (let back = 1; back <= LEVEL_DAYS; back++) {
    recent += at(back) ?? 0;
    yearAgo += at(back + 364) ?? 0;
  }
  if (yearAgo <= 0 || recent <= 0) return null;
  const ratio = clamp(recent / yearAgo, 1 / 3, 3);
  const out = Array.from({ length: horizon }, (_, i) => {
    const date = addDays(from, i);
    const same = LAST_YEAR.map((k) => at(k - i)).filter((v): v is number => v !== undefined);
    return { date, estimate: Math.max(0, ratio * mean(same)) };
  });
  const notes: ForecastNote[] = [];
  if (Math.abs(ratio - 1) >= 0.05) notes.push({ kind: 'growth', yearly: ratio - 1 });
  const ahead = mean(out.map((d) => d.estimate)) / ratio;
  const change = yearAgo > 0 ? ahead / (yearAgo / LEVEL_DAYS) - 1 : 0;
  const counts = new Map<number, number>();
  for (const d of out) counts.set(monthOf(d.date), (counts.get(monthOf(d.date)) ?? 0) + 1);
  const main = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
  if (Math.abs(change) >= 0.05) notes.push({ kind: 'season', month: main, change });
  return { method: 'seasonal', days: out, notes };
}

function core(days: readonly DayValue[], from: string, horizon: number): Core | null {
  const n = days.length;
  if (n < MIN_HISTORY) return null;
  if (n >= 364 + LEVEL_DAYS + 7) {
    const yoy = lastYear(days, from, horizon);
    if (yoy) return yoy;
  }
  const notes: ForecastNote[] = [];

  // Each day as it was (the year-on-year method above handles growth when there are 13 months).
  const level = (d: DayValue) => d.value;

  // Month-of-year pattern from the last year.
  const seasonal = n >= YEAR;
  const monthFactor = new Map<number, number>();
  if (seasonal) {
    const year = days.slice(-YEAR);
    const overall = mean(year.map(level));
    for (let m = 1; m <= 12; m++) {
      const inMonth = year.filter((d) => monthOf(d.date) === m);
      monthFactor.set(
        m,
        overall > 0 && inMonth.length >= 14 ? mean(inMonth.map(level)) / overall : 1,
      );
    }
  }
  const mf = (iso: string) => (seasonal ? (monthFactor.get(monthOf(iso)) ?? 1) : 1);

  // Weekday pattern from the last 12 weeks, the month pattern taken out.
  const recentWeeks = days.slice(-WEEKDAY_DAYS);
  const plain = (d: DayValue) => (mf(d.date) > 0 ? level(d) / mf(d.date) : 0);
  const overallWeek = mean(recentWeeks.map(plain));
  const weekdayFactor = Array.from({ length: 7 }, (_, w) => {
    const on = recentWeeks.filter((d) => weekdayOf(d.date) === w);
    return overallWeek > 0 && on.length ? mean(on.map(plain)) / overallWeek : 1;
  });
  const wf = (iso: string) => weekdayFactor[weekdayOf(iso)] ?? 1;

  // Today's level: the last 4 weeks with both patterns taken out.
  const lastWeeks = days.slice(-LEVEL_DAYS);
  const base = mean(
    lastWeeks.map((d) => {
      const f = mf(d.date) * wf(d.date);
      return f > 0 ? level(d) / f : 0;
    }),
  );

  const out = Array.from({ length: horizon }, (_, i) => {
    const date = addDays(from, i);
    return { date, estimate: Math.max(0, base * mf(date) * wf(date)) };
  });

  if (seasonal) {
    const counts = new Map<number, number>();
    for (const d of out) counts.set(monthOf(d.date), (counts.get(monthOf(d.date)) ?? 0) + 1);
    const main = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
    const recent = mean(lastWeeks.map((d) => mf(d.date)));
    const change = recent > 0 ? (monthFactor.get(main) ?? 1) / recent - 1 : 0;
    if (Math.abs(change) >= 0.05) notes.push({ kind: 'season', month: main, change });
  } else {
    notes.push({ kind: 'no_season', historyDays: n });
  }
  const busiest = weekdayFactor.reduce((best, f, w) => (f > weekdayFactor[best]! ? w : best), 0);
  if (weekdayFactor[busiest]! - 1 >= 0.1)
    notes.push({ kind: 'weekdays', busiest, change: weekdayFactor[busiest]! - 1 });
  return { method: seasonal ? 'seasonal' : 'recent', days: out, notes };
}

/** How far the method was off on the last few 4-week periods (their totals). */
function pastError(days: readonly DayValue[], horizon: number): number | null {
  const h = Math.min(horizon, LEVEL_DAYS);
  const errors: number[] = [];
  for (let k = 1; k <= 3; k++) {
    const cut = days.length - k * LEVEL_DAYS;
    if (cut < LEVEL_DAYS + MIN_HISTORY) break;
    const before = days.slice(0, cut);
    const after = days.slice(cut, cut + h);
    const actual = after.reduce((a, d) => a + d.value, 0);
    const est = core(before, days[cut]!.date, h);
    if (!est || actual <= 0) continue;
    errors.push(Math.abs(est.days.reduce((a, d) => a + d.estimate, 0) / actual - 1));
  }
  return errors.length ? mean(errors) : null;
}

/** Daily estimates for `days` days starting on `from`, from history before it. Null if too little. */
export function forecastDaily(
  history: readonly DayValue[],
  options: { from: string; days: number },
): Forecast | null {
  const days = dense(history, options.from);
  const result = core(days, options.from, Math.max(1, Math.trunc(options.days)));
  if (!result) return null;
  const total = result.days.reduce((a, d) => a + d.estimate, 0);
  const error = clamp(pastError(days, options.days) ?? 0.25, 0.05, 0.6);
  return {
    method: result.method,
    historyDays: days.length,
    days: result.days,
    total,
    low: total * (1 - error),
    high: total * (1 + error),
    error,
    notes: result.notes,
  };
}
