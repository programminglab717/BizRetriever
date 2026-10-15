/**
 * Lenient date parsing for messy spreadsheets. Handles real date cells, Excel serial numbers, ISO
 * text, numeric dates in either order ("03/04/2026"), and month names ("4 Mar 26", "March 4, 2026").
 * Ambiguous numeric dates are resolved with the workspace's date order and reported as ambiguous.
 */

export type DateOrder = 'DMY' | 'MDY' | 'YMD';

export interface ParsedDate {
  /** Calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Wall-clock time if present, `HH:MM:SS`. */
  time?: string;
  /** UTC offset in minutes if the text had one (e.g. -0400 → -240). */
  offsetMinutes?: number;
  /** Shape of the input, e.g. "ISO", "D/M/Y", "M/D/Y", "D MON Y", "SERIAL", "CELL". */
  format: string;
  /** True when the day/month order could not be told from the value itself. */
  ambiguous: boolean;
}

export interface DateOptions {
  /** Used to resolve 03/04/2026. Default MDY. */
  dateOrder?: DateOrder;
  /** Treat plain numbers 20000–80000 as Excel serial dates (only when a column is known to hold dates). */
  allowSerial?: boolean;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');

function validDate(y: number, m: number, d: number): string | undefined {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d)
    return undefined;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function fullYear(y: number): number {
  if (y >= 100) return y;
  // Two-digit years: 00–69 → 2000s, 70–99 → 1900s.
  return y < 70 ? 2000 + y : 1900 + y;
}

function parseTime(rest: string): { time?: string; offsetMinutes?: number } | undefined {
  const text = rest.trim();
  if (text === '') return {};
  const m =
    /^(?:T|\s)?(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(am|pm)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      text,
    );
  if (!m) return undefined;
  let hour = Number(m[1]);
  const ampm = m[4]?.toLowerCase();
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (hour > 23 || Number(m[2]) > 59 || Number(m[3] ?? 0) > 59) return undefined;
  const result: { time?: string; offsetMinutes?: number } = {
    time: `${pad(hour)}:${m[2]}:${m[3] ?? '00'}`,
  };
  if (m[5]) {
    if (m[5].toUpperCase() === 'Z') result.offsetMinutes = 0;
    else {
      const sign = m[5].startsWith('-') ? -1 : 1;
      const digits = m[5].slice(1).replace(':', '');
      result.offsetMinutes = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2)));
    }
  }
  return result;
}

/** Excel's 1900 date system (with its fake 29 Feb 1900): serial 1 = 1900-01-01. */
export function excelSerialToDate(serial: number): { date: string; time?: string } | undefined {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return undefined;
  const ms = Math.round((serial - 25569) * 86_400_000);
  const dt = new Date(ms);
  const date = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  const secs = dt.getUTCHours() * 3600 + dt.getUTCMinutes() * 60 + dt.getUTCSeconds();
  return secs === 0
    ? { date }
    : {
        date,
        time: `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}`,
      };
}

export function parseDate(input: unknown, options: DateOptions = {}): ParsedDate | undefined {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return undefined;
    const date = `${input.getUTCFullYear()}-${pad(input.getUTCMonth() + 1)}-${pad(input.getUTCDate())}`;
    const secs = input.getUTCHours() * 3600 + input.getUTCMinutes() * 60 + input.getUTCSeconds();
    return secs === 0
      ? { date, format: 'CELL', ambiguous: false }
      : {
          date,
          time: `${pad(input.getUTCHours())}:${pad(input.getUTCMinutes())}:${pad(input.getUTCSeconds())}`,
          format: 'CELL',
          ambiguous: false,
        };
  }
  if (typeof input === 'number') {
    if (!options.allowSerial || input < 20_000 || input > 80_000) return undefined;
    const r = excelSerialToDate(input);
    return r ? { ...r, format: 'SERIAL', ambiguous: false } : undefined;
  }
  if (typeof input !== 'string') return undefined;
  const text = input.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (text.length < 6 || text.length > 40) return undefined;

  // ISO-like: 2026-03-04, 2026/03/04, with optional time and offset.
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(.*)$/.exec(text);
  if (m) {
    const date = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    const t = parseTime(m[4]!);
    if (!date || !t) return undefined;
    return { date, ...t, format: m[0].includes('-') ? 'ISO' : 'Y/M/D', ambiguous: false };
  }

  // Numeric with separators: 03/04/2026, 3-4-26, 03.04.2026 (+ optional time).
  m = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4}|\d{2})(?!\d)(.*)$/.exec(text);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[3]);
    const y = fullYear(Number(m[4]));
    const t = parseTime(m[5]!);
    if (!t) return undefined;
    const sep = m[2]!;
    const dmy = validDate(y, b, a);
    const mdy = validDate(y, a, b);
    if (dmy && !mdy) return { date: dmy, ...t, format: `D${sep}M${sep}Y`, ambiguous: false };
    if (mdy && !dmy) return { date: mdy, ...t, format: `M${sep}D${sep}Y`, ambiguous: false };
    if (!dmy || !mdy) return undefined;
    const dayFirst = (options.dateOrder ?? 'MDY') === 'DMY';
    // 03/03/2026 is the same date either way, so it says nothing about the order.
    if (a === b)
      return {
        date: dmy,
        ...t,
        format: dayFirst ? `D${sep}M${sep}Y` : `M${sep}D${sep}Y`,
        ambiguous: true,
      };
    return dayFirst
      ? { date: dmy, ...t, format: `D${sep}M${sep}Y`, ambiguous: true }
      : { date: mdy, ...t, format: `M${sep}D${sep}Y`, ambiguous: true };
  }

  // Month names: "4 Mar 2026", "04-Mar-26", "Tue, 4 March 2026".
  const noWeekday = text.replace(/^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*,?\s+/i, '');
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]([A-Za-z]{3,9})\.?,?[\s-](\d{4}|\d{2})(?!\d)(.*)$/.exec(
    noWeekday,
  );
  if (m) {
    const month = MONTHS[m[2]!.toLowerCase()];
    const date = month ? validDate(fullYear(Number(m[3])), month, Number(m[1])) : undefined;
    const t = parseTime(m[4]!);
    if (!date || !t) return undefined;
    return { date, ...t, format: 'D MON Y', ambiguous: false };
  }
  // "Mar 4 2026", "March 4, 2026", "Mar-04-2026".
  m = /^([A-Za-z]{3,9})\.?[\s-](\d{1,2})(?:st|nd|rd|th)?,?[\s-](\d{4}|\d{2})(?!\d)(.*)$/.exec(
    noWeekday,
  );
  if (m) {
    const month = MONTHS[m[1]!.toLowerCase()];
    const date = month ? validDate(fullYear(Number(m[3])), month, Number(m[2])) : undefined;
    const t = parseTime(m[4]!);
    if (!date || !t) return undefined;
    return { date, ...t, format: 'MON D Y', ambiguous: false };
  }
  return undefined;
}
