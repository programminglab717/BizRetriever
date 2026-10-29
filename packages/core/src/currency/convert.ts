import { isDateValue } from '@bizr/ingest';

import type {
  EntitySpec,
  Issue,
  MaterializedRecord,
  MaterializeResult,
} from '../ingestion/materialize';

/**
 * Converting amounts into the business's currency (M20, ADR-070). Pure: the rates are handed in.
 * All arithmetic is on exact decimals (BigInt), rounded half away from zero to 4 places, the
 * precision money is stored at.
 */

/** Units of each currency one euro bought, by day. EUR itself is always 1. */
export interface RateBook {
  /** `perEur` for `currency` on `day`, or on the latest day before it within a week. */
  rate(currency: string, day: string): string | null;
}

/** How far back a missing day (weekend, holiday, not yet published) may borrow a rate. */
export const RATE_LOOKBACK_DAYS = 7;

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

function scaled(value: string): { n: bigint; scale: number } {
  const m = DECIMAL.exec(value.trim());
  if (!m) throw new Error(`Not a decimal: ${value}`);
  const frac = m[3] ?? '';
  const n = BigInt(`${m[2]}${frac}`);
  return { n: m[1] ? -n : n, scale: frac.length };
}

function unscale(n: bigint, scale: number): string {
  const neg = n < 0n;
  const digits = (neg ? -n : n).toString().padStart(scale + 1, '0');
  return `${neg ? '-' : ''}${digits.slice(0, digits.length - scale)}.${digits.slice(-scale)}`;
}

/** A finite number as a plain decimal string (no exponent). */
export function numberToDecimal(v: number): string {
  return v.toFixed(6);
}

/**
 * `amount` in a currency worth `fromPerEur` per euro, in a currency worth `toPerEur` per euro:
 * amount × to ÷ from, to 4 decimal places.
 */
export function convertAmount(amount: string, fromPerEur: string, toPerEur: string): string {
  const a = scaled(amount);
  const to = scaled(toPerEur);
  const from = scaled(fromPerEur);
  if (from.n === 0n) throw new Error('A rate of zero');
  // result × 10^4 = a.n·10^-a.scale × to.n·10^-to.scale ÷ (from.n·10^-from.scale) × 10^4
  let num = a.n * to.n * 10n ** BigInt(4 + from.scale);
  let den = from.n * 10n ** BigInt(a.scale + to.scale);
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  let q = num / den;
  const r = num % den;
  if (2n * (r < 0n ? -r : r) >= den) q += num < 0n ? -1n : 1n;
  return unscale(q, 4);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A rate book over rows `(day, currency, perEur)`. */
export function rateBook(rows: readonly { day: string; currency: string; perEur: string }[]) {
  const byCurrency = new Map<string, Map<string, string>>();
  for (const r of rows) {
    const c = r.currency.trim().toUpperCase();
    let m = byCurrency.get(c);
    if (!m) byCurrency.set(c, (m = new Map<string, string>()));
    m.set(r.day, r.perEur);
  }
  return {
    rate(currency: string, day: string): string | null {
      if (currency === 'EUR') return '1';
      const m = byCurrency.get(currency);
      if (!m) return null;
      for (let i = 0; i <= RATE_LOOKBACK_DAYS; i += 1) {
        const v = m.get(addDays(day, -i));
        if (v) return v;
      }
      return null;
    },
  } satisfies RateBook;
}

/**
 * The day an amount belongs to: the record's first date; else the date of a record it's linked to
 * (an order line takes its order's date), up to two links away; else `today`.
 */
export function recordDay(
  rec: Pick<MaterializedRecord, 'fields' | 'links'>,
  spec: EntitySpec,
  today: string,
  linked?: { result: MaterializeResult; specs: readonly EntitySpec[] },
  depth = 0,
): string {
  for (const f of spec.fields) {
    if (f.type !== 'date' && f.type !== 'datetime') continue;
    const v = rec.fields[f.key];
    if (isDateValue(v) && /^\d{4}-\d{2}-\d{2}$/.test(v.date)) return v.date;
  }
  if (linked && depth < 2) {
    for (const f of spec.fields) {
      if (f.type !== 'reference' || !f.references) continue;
      const at = rec.links[f.key];
      const target = linked.specs.find((s) => s.key === f.references);
      const parent =
        at === null || at === undefined
          ? undefined
          : linked.result.entities.get(f.references)?.[at];
      if (!target || !parent) continue;
      const day = recordDay(parent, target, '', linked, depth + 1);
      if (day) return day;
    }
  }
  return today;
}

/** Every (currency, day) a result needs a rate for, so they can be fetched first. */
export function neededRates(
  result: MaterializeResult,
  specs: readonly EntitySpec[],
  business: string,
  today: string,
): { currency: string; day: string }[] {
  const out = new Map<string, { currency: string; day: string }>();
  for (const spec of specs) {
    for (const rec of result.entities.get(spec.key) ?? []) {
      if (!rec.currencies) continue;
      const day = recordDay(rec, spec, today, { result, specs });
      for (const c of new Set([...Object.values(rec.currencies), business])) {
        if (c !== 'EUR') out.set(`${c}:${day}`, { currency: c, day });
      }
    }
  }
  return [...out.values()];
}

export interface ConversionSummary {
  /** Currency → how many amounts were converted. */
  converted: Record<string, number>;
  /** Amounts left empty because no rate is published for that currency and day. */
  missing: { currency: string; count: number; firstDay: string }[];
}

/**
 * Converts, in place, every money value `materialize` marked as being in another currency. An
 * amount with no published rate is left empty and reported (never mixed in unconverted).
 */
export function convertRecords(
  result: MaterializeResult,
  specs: readonly EntitySpec[],
  business: string,
  book: RateBook,
  today: string,
): ConversionSummary {
  const converted: Record<string, number> = {};
  const missing = new Map<string, { currency: string; count: number; firstDay: string }>();
  for (const spec of specs) {
    for (const rec of result.entities.get(spec.key) ?? []) {
      if (!rec.currencies) continue;
      const day = recordDay(rec, spec, today, { result, specs });
      const to = book.rate(business, day);
      for (const [field, currency] of Object.entries(rec.currencies)) {
        const v = rec.fields[field];
        if (typeof v !== 'number' && typeof v !== 'string') continue;
        const amount = typeof v === 'number' ? numberToDecimal(v) : v;
        const from = book.rate(currency, day);
        if (from && to && DECIMAL.test(amount)) {
          rec.fields[field] = convertAmount(amount, from, to);
          converted[currency] = (converted[currency] ?? 0) + 1;
          continue;
        }
        rec.fields[field] = null;
        const m = missing.get(currency) ?? { currency, count: 0, firstDay: day };
        m.count += 1;
        if (day < m.firstDay) m.firstDay = day;
        missing.set(currency, m);
        const at = rec.lineage[0];
        const label = spec.fields.find((f) => f.key === field)?.label ?? field;
        const issue: Issue = {
          code: 'unreadable_value',
          entity: spec.key,
          field,
          sourceId: at?.sourceId ?? '',
          fileName: at?.fileName ?? '',
          sheet: at?.sheet ?? '',
          row: at?.row ?? 0,
          message: `${label}: no published exchange rate for ${currency} on ${day}, so it was left empty`,
        };
        result.issues.push(issue);
      }
    }
  }
  return { converted, missing: [...missing.values()] };
}

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** Plain-language lines for the review and the data report. */
export function conversionNotes(summary: ConversionSummary, business: string): string[] {
  const notes: string[] = [];
  const done = Object.entries(summary.converted).sort((a, b) => b[1] - a[1]);
  if (done.length > 0) {
    const list = done.map(([c, n]) => `${plural(n, 'amount', 'amounts')} in ${c}`).join(', ');
    notes.push(
      `${list} converted to ${business} at the European Central Bank’s rate for each record’s date.`,
    );
  }
  for (const m of summary.missing) {
    notes.push(
      `${plural(m.count, 'amount', 'amounts')} in ${m.currency} left empty: there’s no published exchange rate for it (from ${m.firstDay}).`,
    );
  }
  return notes;
}
