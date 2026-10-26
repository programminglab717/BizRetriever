import { toAnswerData } from '../ask/answer';
import { QueryExecutionError } from '../executor/execute';
import { SemanticError } from '../semantic/graph';
import { loadSemanticModel, runQuery } from '../semantic/service';
import type { MemberWorkspace } from '../workspaces/service';
import { addDays, forecastDaily, type ForecastNote } from './forecast';
import { dailyHistory } from './service';

/**
 * The reorder list (M11, ADR-060): every product whose stock won't last the supplier's lead time
 * plus 30 days at its recent rate. The suggestion covers that window, adjusted by the business's
 * usual season for those weeks (from its items-sold estimate), the same way for every product.
 * Measures come from the pack (`days_of_cover`, `daily_sales_rate`, `stock_on_hand`), the same
 * ones the "running out" alert uses.
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
}

export interface ReorderList {
  lines: ReorderLine[];
  /** Expected sales in the coming weeks against the last 4 weeks (1.43 = 43% more). */
  seasonFactor: number;
  seasonNote: Extract<ForecastNote, { kind: 'season' }> | null;
  /** False when the data has no stock counts or sales to work from. */
  available: boolean;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The business's own expected rise or fall over the next `days`, from items sold. */
async function seasonFactor(member: MemberWorkspace, days: number, now?: Date) {
  try {
    const h = await dailyHistory(member, SEASON_MEASURE, now ? { now } : {});
    const f = forecastDaily(h.history, { from: h.today, days });
    const recent = h.history.filter((d) => d.date >= addDays(h.today, -28) && d.date < h.today);
    const perDay = recent.reduce((a, d) => a + d.value, 0) / 28;
    if (!f || perDay <= 0) return { factor: 1, note: null };
    const factor = Math.min(3, Math.max(0.5, f.total / days / perDay));
    const note = f.notes.find((n) => n.kind === 'season') ?? null;
    return {
      factor,
      note: Math.abs(factor - 1) >= 0.1 ? note : null,
    };
  } catch (err) {
    if (err instanceof SemanticError || err instanceof QueryExecutionError)
      return { factor: 1, note: null };
    throw err;
  }
}

export async function reorderList(
  member: MemberWorkspace,
  options: { now?: Date } = {},
): Promise<ReorderList> {
  const model = await loadSemanticModel(member.workspace);
  const needed = ['days_of_cover', 'daily_sales_rate', 'stock_on_hand'];
  if (!needed.every((m) => model.metrics.has(m)))
    return { lines: [], seasonFactor: 1, seasonNote: null, available: false };
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
        having: [{ metric: 'daily_sales_rate', op: 'gt', value: 0 }],
        sort: { by: 'days_of_cover', dir: 'asc' },
        limit: 1000,
      },
      'system',
      model,
    );
    data = toAnswerData(r);
  } catch (err) {
    if (err instanceof SemanticError || err instanceof QueryExecutionError)
      return { lines: [], seasonFactor: 1, seasonNote: null, available: false };
    throw err;
  }
  const key = (id: string) => data.columns.find((c) => c.metric === id)!.key;
  const dims = data.columns.filter((c) => c.kind === 'dimension');
  const leadCol = dims.find((c) => c.field === 'supplier.lead_time_days');
  const supplierCol = dims.find((c) => c.field === 'supplier.name');
  const productCol = dims.find((c) => c.field === 'product.name')!;

  const rows = data.rows.map((r) => {
    const lead = leadCol ? num(r[leadCol.key]) : null;
    const leadDays = lead !== null && lead > 0 ? Math.round(lead) : DEFAULT_LEAD_DAYS;
    return {
      product: String(r[productCol.key] ?? ''),
      supplier: supplierCol ? ((r[supplierCol.key] as string | null) ?? null) : null,
      leadDays,
      leadAssumed: lead === null || lead <= 0,
      onHand: num(r[key('stock_on_hand')]) ?? 0,
      perDay: num(r[key('daily_sales_rate')]) ?? 0,
      daysOfCover: num(r[key('days_of_cover')]) ?? 0,
    };
  });
  const longest = Math.max(DEFAULT_LEAD_DAYS, ...rows.map((r) => r.leadDays)) + COVER_EXTRA_DAYS;
  const season = await seasonFactor(member, longest, options.now);

  const lines = rows
    .map((r): ReorderLine => {
      const coverDays = r.leadDays + COVER_EXTRA_DAYS;
      const suggested = Math.max(0, Math.ceil(r.perDay * coverDays * season.factor - r.onHand));
      return { ...r, coverDays, suggested, soon: r.daysOfCover <= r.leadDays };
    })
    .filter((l) => l.product && l.suggested > 0)
    .sort((a, b) => a.daysOfCover - b.daysOfCover || a.product.localeCompare(b.product));
  return { lines, seasonFactor: season.factor, seasonNote: season.note, available: true };
}
