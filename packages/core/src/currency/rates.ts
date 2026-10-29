import { fxRate, getAppDb, workspaceSettings } from '@bizr/db';
import { getLogger } from '@bizr/platform';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';

import type { EntitySpec, MaterializeResult } from '../ingestion/materialize';
import {
  addDays,
  convertRecords,
  neededRates,
  rateBook,
  RATE_LOOKBACK_DAYS,
  type ConversionSummary,
  type RateBook,
} from './convert';
import { fetchEcbRates, type EcbRate } from './ecb';

/** Stored rates (`app.fx_rate`): fetched once, shared by every business. */

export async function storeRates(rows: readonly EcbRate[]): Promise<number> {
  const db = getAppDb();
  let added = 0;
  for (let i = 0; i < rows.length; i += 2_000) {
    const res = await db
      .insert(fxRate)
      .values(rows.slice(i, i + 2_000).map((r) => ({ ...r })))
      .onConflictDoNothing()
      .returning({ day: fxRate.day });
    added += res.length;
  }
  return added;
}

async function storedBook(currencies: string[], from: string, to: string): Promise<RateBook> {
  const list = currencies.filter((c) => c !== 'EUR');
  if (list.length === 0) return rateBook([]);
  const rows = await getAppDb()
    .select({ day: fxRate.day, currency: fxRate.currency, perEur: fxRate.perEur })
    .from(fxRate)
    .where(
      and(
        inArray(fxRate.currency, list),
        gte(fxRate.day, addDays(from, -RATE_LOOKBACK_DAYS)),
        lte(fxRate.day, to),
      ),
    );
  return rateBook(rows);
}

/** Avoid asking the ECB again for a file we fetched in the last few hours. */
const fetchedAt = new Map<'recent' | 'history', number>();
const REFETCH_MS = 6 * 60 * 60 * 1000;

/** For tests: forget earlier fetches. */
export function resetRateFetches(): void {
  fetchedAt.clear();
}

async function fetchOnce(kind: 'recent' | 'history', now: number): Promise<boolean> {
  const last = fetchedAt.get(kind);
  if (last !== undefined && now - last < REFETCH_MS) return false;
  fetchedAt.set(kind, now);
  try {
    await storeRates(await fetchEcbRates(kind === 'history'));
    return true;
  } catch (err) {
    getLogger('currency').warn({ err, kind }, 'fetching exchange rates failed');
    return false;
  }
}

/**
 * A rate book that covers `needed` as far as the ECB publishes it: missing rates are fetched first
 * (the last 90 days, or the whole history for older records). Rates that still don't exist (a
 * currency the ECB doesn't publish) stay missing; the caller reports them.
 */
export async function ensureRates(
  needed: readonly { currency: string; day: string }[],
  today: string,
  now = Date.now(),
): Promise<RateBook> {
  if (needed.length === 0) return rateBook([]);
  const currencies = [...new Set(needed.map((n) => n.currency))];
  const days = needed.map((n) => n.day).sort();
  const from = days[0]!;
  const to = days[days.length - 1]! > today ? days[days.length - 1]! : today;
  let book = await storedBook(currencies, from, to);
  const gaps = needed.filter((n) => book.rate(n.currency, n.day) === null);
  if (gaps.length === 0) return book;
  const recentFrom = addDays(today, -80);
  const recent = gaps.some((g) => g.day >= recentFrom) && (await fetchOnce('recent', now));
  const history = gaps.some((g) => g.day < recentFrom) && (await fetchOnce('history', now));
  if (recent || history) book = await storedBook(currencies, from, to);
  return book;
}

/** Fetches what's needed, then converts `result` in place (see `convertRecords`). */
export async function convertToBusinessCurrency(
  result: MaterializeResult,
  specs: readonly EntitySpec[],
  business: string,
  today: string,
): Promise<ConversionSummary> {
  const needed = neededRates(result, specs, business, today);
  if (needed.length === 0) return { converted: {}, missing: [] };
  const book = await ensureRates(needed, today);
  return convertRecords(result, specs, business, book, today);
}

/**
 * Remembers which currencies a business's amounts were converted from, so answers about money can
 * say so (an assumption shown with the answer).
 */
export async function rememberConverted(
  workspaceId: string,
  summary: ConversionSummary,
): Promise<void> {
  const codes = Object.keys(summary.converted).filter((c) => /^[A-Z]{3}$/.test(c));
  if (codes.length === 0) return;
  await getAppDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ list: workspaceSettings.convertedCurrencies })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, workspaceId))
      .for('update');
    const list = [...new Set([...(row?.list ?? []), ...codes])].sort();
    await tx
      .update(workspaceSettings)
      .set({ convertedCurrencies: list })
      .where(eq(workspaceSettings.workspaceId, workspaceId));
  });
}
