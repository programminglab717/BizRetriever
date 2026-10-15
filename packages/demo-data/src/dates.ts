/** Calendar-date helpers on plain `YYYY-MM-DD` strings (UTC maths, no time zones involved). */

export type IsoDate = string;

export function parseIsoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Expected YYYY-MM-DD, got ${value}`);
  return new Date(`${value}T00:00:00Z`);
}

export function toIso(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = parseIsoDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86_400_000);
}

export function month(date: IsoDate): number {
  return Number(date.slice(5, 7));
}

export function year(date: IsoDate): number {
  return Number(date.slice(0, 4));
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: IsoDate): number {
  return parseIsoDate(date).getUTCDay();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthName(m: number): string {
  return MONTHS[m - 1]!;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `DD/MM/YYYY` (Etsy sheet in the demo, deliberately day-first). */
export function dmy(date: IsoDate): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

/** `MM/DD/YYYY` (US style). */
export function mdy(date: IsoDate): string {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}`;
}

/** `Mar 4 2026`. */
export function shortText(date: IsoDate): string {
  return `${monthName(month(date))} ${Number(date.slice(8, 10))} ${year(date)}`;
}

export function timeOfDay(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}
