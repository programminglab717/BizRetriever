import { closePools, getAppDb, insight, type Insight } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { toAnswerData } from '../ask/answer';
import { resolvePreset } from '../ask/time';
import { dashboardView } from '../dashboard/service';
import { runQuery } from '../semantic/service';
import { loadWholesaleWorkspace, type WholesaleWorkspace } from '../testing';
import type { FactValue } from './evaluate';
import { homeKpis } from './home';
import { runInsights } from './service';

/**
 * M14 acceptance: the Harbour & Pine wholesale demo is brought in without AI, its numbers match the
 * answer key, and every planted story is found by the wholesale pack's insights.
 */
const hasDb = await databaseAvailable();
const TODAY = '2026-10-13';
const NOW = new Date(`${TODAY}T16:00:00Z`);
const num = (f: FactValue | undefined) => (f && f.format !== 'text' ? f.value : NaN);

describe.skipIf(!hasDb)('the wholesale pack on its demo business (integration)', () => {
  let w: WholesaleWorkspace;
  let rows: Insight[];
  const s = () => w.truth.stories;
  const one = (ruleId: string, subject?: string) => {
    const found = rows.filter(
      (r) => r.ruleId === ruleId && (subject === undefined || r.subject === subject),
    );
    expect(
      found,
      `${ruleId} ${subject ?? ''}: ${rows.map((r) => r.text).join(' | ')}`,
    ).toHaveLength(1);
    return found[0]!;
  };
  const facts = (r: Insight) => r.facts as Record<string, FactValue>;
  const total = async (metric: string, period?: { from: string; to: string }) => {
    const d = toAnswerData(
      await runQuery(w.member, { metrics: [metric], ...(period ? { period } : {}) }, 'system'),
    );
    const key = d.columns.find((c) => c.metric === metric)!.key;
    return Number(d.rows[0]?.[key]);
  };

  beforeAll(async () => {
    w = await loadWholesaleWorkspace({ today: TODAY });
    await runInsights(w.member, { trigger: 'import', now: NOW, provider: null });
    rows = await getAppDb()
      .select()
      .from(insight)
      .where(eq(insight.workspaceId, w.member.workspace.id));
  }, 240_000);
  afterAll(async () => {
    await w?.dispose();
    await closePools();
  });

  it('brings every invoice, account and payment in, with the right totals', async () => {
    expect(await total('order_count', { from: '2020-01-01', to: TODAY })).toBe(w.truth.counts.sale);
    expect(
      await total(
        'net_sales',
        resolvePreset('last_30_days', { today: TODAY, weekStart: 1, fiscalYearStartMonth: 1 }),
      ),
    ).toBeCloseTo(Number(s().totals!.netSalesLast30Days), 2);
    // Owed and overdue as of today.
    const asOfToday = { from: '2020-01-01', to: TODAY };
    expect(await total('outstanding_receivables', asOfToday)).toBeCloseTo(
      Number(s().totals!.moneyOwed),
      2,
    );
    expect(await total('overdue_receivables', asOfToday)).toBeCloseTo(
      Number(s().overdue!.totalOwed),
      2,
    );
    expect(await total('credit_limit_total', asOfToday)).toBeGreaterThan(0);
  });

  it('shows the pack’s own key numbers on Home: sales, profit and money owed', async () => {
    const home = await homeKpis(w.member, { now: NOW });
    expect(home.kpis.map((k) => k.label)).toEqual([
      'Net sales',
      'Gross profit',
      'Money owed to you',
    ]);
  });

  it('builds the wholesale dashboard with every tile working and nothing left to unlock', async () => {
    const view = await dashboardView(w.member);
    expect(view.tiles.map((t) => t.packKey)).toEqual([
      'net_sales',
      'gross_profit',
      'money_owed',
      'sales_over_time',
      'days_to_pay',
      'top_customers',
      'who_owes',
      'sales_by_rep',
      'top_products_profit',
      'running_low',
      'backorders',
      'slow_stock_total',
    ]);
    expect(view.tiles.filter((t) => t.error).map((t) => `${t.title}: ${t.error}`)).toEqual([]);
    expect(view.unlock).toEqual([]);
  });

  it('finds the customer over their credit limit', () => {
    const story = s().overCredit!;
    const r = one('over_credit_limit', String(story.customer));
    expect(num(facts(r).owed)).toBeCloseTo(Number(story.owed), 2);
    expect(num(facts(r).limit)).toBeCloseTo(Number(story.creditLimit), 2);
    expect(r.level).toBe('urgent');
  });

  it('finds the customer paying later than usual', () => {
    const story = s().payingLater!;
    const r = one('paying_later', String(story.customer));
    expect(num(facts(r).now)).toBeCloseTo(Number(story.daysLast90), 0);
    expect(num(facts(r).before)).toBeCloseTo(Number(story.daysBefore), 0);
  });

  it('finds the account that missed its usual reorder', () => {
    const story = s().missedReorder!;
    const r = one('missed_reorder', String(story.customer));
    expect(num(facts(r).usual)).toBeCloseTo(Number(story.usualGapDays), 0);
    expect(num(facts(r).since)).toBe(story.daysSinceLastOrder);
  });

  it('finds the account ordering much less', () => {
    const story = s().slipping!;
    const r = one('customer_slipping', String(story.customer));
    expect(num(facts(r).drop_pct) * 100).toBeCloseTo(Number(story.dropPct), 0);
  });

  it('finds the backorders, the stock-out, the cost rise and the dead stock', () => {
    const bo = one('backorders_building', String(s().backorders!.product));
    expect(num(facts(bo).units)).toBe(s().backorders!.unitsLast28Days);
    const out = one('stockout_risk', String(s().stockout!.product));
    expect(num(facts(out).days)).toBeCloseTo(Number(s().stockout!.daysOfCover), 0);
    const cost = one('margin_squeeze', String(s().costRise!.product));
    expect(num(facts(cost).new_cost)).toBeCloseTo(Number(s().costRise!.costAfter), 2);
    expect(one('dead_stock').text).toMatch(/2 products haven't sold/);
  });

  it('finds the overdue invoices', () => {
    const r = one('overdue_payments');
    expect(num(facts(r).amount)).toBeCloseTo(Number(s().overdue!.totalOwed), 2);
    expect(num(facts(r).count)).toBe((s().overdue!.customers as string[]).length);
  });
});
