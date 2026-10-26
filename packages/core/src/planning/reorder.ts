import { toAnswerData } from '../ask/answer';
import { QueryExecutionError } from '../executor/execute';
import { SemanticError } from '../semantic/graph';
import { loadSemanticModel, runQuery } from '../semantic/service';
import type { MemberWorkspace } from '../workspaces/service';
import { addDays, forecastDaily, type ForecastNote } from './forecast';
import { dailyHistory } from './service';

/**
 * The reorder list (M11, ADR-060; per-product seasons M12, ADR-061): every product whose stock
 * won't cover what it's expected to sell over the supplier's lead time plus 30 days. Expected is
 * the recent rate adjusted by the business's usual season for those weeks (from its items-sold
 * estimate); with 13 months of history, it is at least what the product sold in the same weeks last
 * year, scaled by how the business is doing against a year ago. So Christmas stock shows up in
 * October although it isn't selling yet. Measures come from the pack (`days_of_cover`,
 * `daily_sales_rate`, `stock_on_hand`, `units_sold`), as the "running out" alert uses them.
 */

export const DEFAULT_LEAD_DAYS = 14;
export const COVER_EXTRA_DAYS = 30;
const SEASON_MEASURE = 'units_sold';

export interface ReorderLine {
  product: string;
  supplier: string | null;
  leadDays: number;
  /** The supplier has no lead time recorded: 14 days was assumed. */
  leadAssumed: boolean;
  onHand: number;
  perDay: number;
  daysOfCover: number;
  /** Lead time + 30 days. */
  coverDays: number;
  suggested: number;
  /** Stock may run out before a new order arrives. */
  soon: boolean;
  /** Sold in the same weeks last year (null without 13 months of history). */
  lastYear: number | null;
  /** The suggestion comes from last year's season rather than the recent rate. */
  seasonal: boolean;
}

export interface ReorderList {
  lines: ReorderLine[];
  /** Expected sales in the coming weeks against the last 4 weeks (1.43 = 43% more). */
  seasonFactor: number;
  seasonNote: Extract<ForecastNote, { kind: 'season' }> | null;
  /** False when the data has no stock counts or sales to work from. */
  available: boolean;
  /** Each product's own season from last year is used (13 months of history or more). */
  perProductSeasons: boolean;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The business's own expected rise or fall over the next `days` (from its items-sold estimate), and
 * its last 4 weeks against the same weeks a year earlier when there's history for it.
 */
async function businessTrend(member: MemberWorkspace, days: number, now?: Date) {
  try {
    const h = await dailyHistory(member, SEASON_MEASURE, now ? { now } : {});
    const sum = (from: string, to: string) =>
      h.history.filter((d) => d.date >= from && d.date < to).reduce((a, d) => a + d.value, 0);
    const recent = sum(addDays(h.today, -28), h.today);
    const yearAgo = sum(addDays(h.today, -28 - 364), addDays(h.today, -364));
    const first = h.history[0]?.date;
    const hasYear = Boolean(first && first <= addDays(h.today, -28 - 364) && yearAgo > 0);
    const f = forecastDaily(h.history, { from: h.today, days });
    const factor = f && recent > 0 ? Math.min(3, Math.max(0.5, f.total / days / (recent / 28))) : 1;
    const note = f?.notes.find((n) => n.kind === 'season') ?? null;
    return {
      today: h.today,
      factor,
      note: Math.abs(factor - 1) >= 0.1 ? note : null,
      /** Recent weeks against a year ago, or null without the history. */
      yearOnYear: hasYear ? Math.min(2, Math.max(0.5, recent / yearAgo)) : null,
    };
  } catch (err) {
    if (err instanceof SemanticError || err instanceof QueryExecutionError)
      return { today: null, factor: 1, note: null, yearOnYear: null };
    throw err;
  }
}

const empty: ReorderList = {
  lines: [],
  seasonFactor: 1,
  seasonNote: null,
  available: false,
  perProductSeasons: false,
};

export async function reorderList(
  member: MemberWorkspace,
  options: { now?: Date } = {},
): Promise<ReorderList> {
  const model = await loadSemanticModel(member.workspace);
  const needed = ['days_of_cover', 'daily_sales_rate', 'stock_on_hand'];
  if (!needed.every((m) => model.metrics.has(m))) return empty;
  const hasSupplier = model.dimensions.some((d) => d.field === 'supplier.name');
  const hasLead = model.dimensions.some((d) => d.field === 'supplier.lead_time_days');
  let data;
  try {
    const r = await runQuery(
      member,
      {
        metrics: needed,
        dimensions: [
          { field: 'product.name' },
          ...(hasSupplier ? [{ field: 'supplier.name' }] : []),
          ...(hasSupplier && hasLead ? [{ field: 'supplier.lead_time_days' }] : []),
        ],
        sort: { by: 'days_of_cover', dir: 'asc' },
        limit: 1000,
      },
      'system',
      model,
    );
    data = toAnswerData(r);
  } catch (err) {
    if (err instanceof SemanticError || err instanceof QueryExecutionError) return empty;
    throw err;
  }
  const key = (id: string) => data.columns.find((c) => c.metric === id)!.key;
  const dims = data.columns.filter((c) => c.kind === 'dimension');
  const leadCol = dims.find((c) => c.field === 'supplier.lead_time_days');
  const supplierCol = dims.find((c) => c.field === 'supplier.name');
  const productCol = dims.find((c) => c.field === 'product.name')!;

  const rows = data.rows
    .map((r) => {
      const lead = leadCol ? num(r[leadCol.key]) : null;
      const leadDays = lead !== null && lead > 0 ? Math.round(lead) : DEFAULT_LEAD_DAYS;
      return {
        product: String(r[productCol.key] ?? ''),
        supplier: supplierCol ? ((r[supplierCol.key] as string | null) ?? null) : null,
        leadDays,
        leadAssumed: lead === null || lead <= 0,
        onHand: Math.max(0, num(r[key('stock_on_hand')]) ?? 0),
        perDay: Math.max(0, num(r[key('daily_sales_rate')]) ?? 0),
        /** The pack's own measure, as the "running out" alert shows it. */
        cover: num(r[key('days_of_cover')]),
        coverDays: leadDays + COVER_EXTRA_DAYS,
      };
    })
    .filter((r) => r.product);
  const longest = Math.max(DEFAULT_LEAD_DAYS, ...rows.map((r) => r.leadDays)) + COVER_EXTRA_DAYS;
  const trend = await businessTrend(member, longest, options.now);

  // Each product's same weeks last year, one question per cover length (a few suppliers' lead times).
  const lastYear = new Map<string, Map<string, number>>();
  const perProduct =
    trend.yearOnYear !== null && trend.today !== null && model.metrics.has(SEASON_MEASURE);
  if (perProduct)
    for (const cover of new Set(rows.map((r) => r.coverDays))) {
      const from = addDays(trend.today, -364);
      const r = toAnswerData(
        await runQuery(
          member,
          {
            metrics: [SEASON_MEASURE],
            dimensions: [{ field: 'product.name' }],
            period: { from, to: addDays(from, cover) },
            limit: 1000,
          },
          'system',
          model,
        ),
      );
      const p = r.columns.find((c) => c.kind === 'dimension')!;
      const m = r.columns.find((c) => c.kind === 'metric')!;
      lastYear.set(
        String(cover),
        new Map(r.rows.map((row) => [String(row[p.key] ?? ''), Math.max(0, num(row[m.key]) ?? 0)])),
      );
    }

  const lines = rows
    .map((r): ReorderLine => {
      const recentNeed = r.perDay * r.coverDays * trend.factor;
      const sold = perProduct ? (lastYear.get(String(r.coverDays))?.get(r.product) ?? 0) : null;
      const yearNeed = sold !== null ? sold * trend.yearOnYear! : 0;
      const need = Math.max(recentNeed, yearNeed);
      const perDayNeed = need / r.coverDays;
      // Selling now: the alert's own days of stock. Not yet (a seasonal product): at the expected rate.
      const daysOfCover =
        r.perDay > 0 && r.cover !== null
          ? r.cover
          : perDayNeed > 0
            ? r.onHand / perDayNeed
            : Number.POSITIVE_INFINITY;
      const { cover: _cover, ...line } = r;
      return {
        ...line,
        daysOfCover,
        suggested: Math.max(0, Math.ceil(need - r.onHand)),
        soon: daysOfCover <= r.leadDays,
        lastYear: sold,
        seasonal: yearNeed > 0 && yearNeed > recentNeed * 1.5,
      };
    })
    .filter((l) => l.suggested > 0)
    .sort((a, b) => a.daysOfCover - b.daysOfCover || a.product.localeCompare(b.product));
  return {
    lines,
    seasonFactor: trend.factor,
    seasonNote: trend.note,
    available: true,
    perProductSeasons: perProduct,
  };
}
