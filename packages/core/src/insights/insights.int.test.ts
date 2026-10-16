import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { GenerateRequest, GenerateResult, LLMProvider } from '@bizr/ai';
import { closePools, digest, getAppDb, insight, type Insight } from '@bizr/db';
import { generateDemoDataset, type GroundTruth } from '@bizr/demo-data';
import { databaseAvailable } from '@bizr/platform/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadDemoWorkspace, type DemoWorkspace } from '../testing';
import type { DigestContent } from './digest';
import type { FactValue } from './evaluate';
import {
  dismissInsight,
  getAlertSettings,
  getInsights,
  InsightError,
  saveAlertSetting,
} from './feed';
import { runInsights } from './service';

/**
 * M7 acceptance: on the demo business every planted story is found with the numbers the ground
 * truth gives, and the control business (same shape, no stories) raises no urgent alert.
 */
const hasDb = await databaseAvailable();
const TODAY = '2026-10-13';
// Midday in New York on the demo's "today".
const NOW = new Date(`${TODAY}T16:00:00Z`);

type Stories = Record<string, Record<string, unknown>>;

/** Task J without the live AI: rewords the slipping-customer alert, keeps the rest as they are. */
const SLIPPING =
  '{{customer}} is spending less: down {{drop_pct}} on their usual, and their last order was {{days_since}} {{days_since|day|days}} ago.';
const phraser: LLMProvider = {
  generate<T>(request: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const content = String(request.messages[0]!.content);
    const alerts = JSON.parse(/<alerts>\n(.*)\n<\/alerts>/s.exec(content)![1]!) as {
      id: string;
      topic: string;
      template: string;
    }[];
    const items = alerts.map((a) => ({
      id: a.id,
      text: a.topic === 'Regular customers buying less' ? SLIPPING : a.template,
    }));
    return Promise.resolve({
      data: request.schema.parse({ items }),
      model: 'fake',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsd: 0,
      latencyMs: 0,
      replayed: true,
    });
  },
};
const num = (f: FactValue | undefined) => (f && f.format !== 'text' ? f.value : NaN);
const txt = (f: FactValue | undefined) => (f?.format === 'text' ? f.value : undefined);
/** Money kept as the exact decimal Postgres returned (summed without floats). */
const exact = (f: FactValue | undefined) =>
  f && f.format === 'money' && f.exact ? Number(f.exact) : NaN;

describe.skipIf(!hasDb)('insights on the demo data (integration)', () => {
  let demo: DemoWorkspace;
  let control: DemoWorkspace;
  let truth: Stories;

  const rowsOf = async (w: DemoWorkspace) =>
    getAppDb().select().from(insight).where(eq(insight.workspaceId, w.member.workspace.id));
  const one = async (w: DemoWorkspace, ruleId: string, subject?: string): Promise<Insight> => {
    const rows = (await rowsOf(w)).filter(
      (r) => r.ruleId === ruleId && (subject === undefined || r.subject === subject),
    );
    expect(rows, `${ruleId} ${subject ?? ''}`).toHaveLength(1);
    return rows[0]!;
  };
  const facts = (r: Insight) => r.facts as Record<string, FactValue>;

  beforeAll(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fernwood-truth-'));
    try {
      const t: GroundTruth = await generateDemoDataset({ today: TODAY, seed: 42, outDir: dir });
      truth = t.stories;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    demo = await loadDemoWorkspace({ today: TODAY });
    control = await loadDemoWorkspace({ today: TODAY, stories: false, name: 'Control Shop' });
    await runInsights(demo.member, { trigger: 'import', now: NOW, provider: phraser });
    await runInsights(control.member, { trigger: 'import', now: NOW, provider: null });
  }, 240_000);

  afterAll(async () => {
    await demo?.dispose();
    await control?.dispose();
    await closePools();
  });

  it('finds the stock-out risk, urgent, with the true rate and cover', async () => {
    const s = truth.stockoutRisk!;
    const r = await one(demo, 'stockout_risk', String(s.product));
    expect(r.level).toBe('urgent');
    const f = facts(r);
    expect(num(f.days)).toBeCloseTo(Number(s.daysOfCover), 0);
    expect(num(f.rate)).toBeCloseTo(Number(s.unitsLast28Days) / 28, 4);
    expect(num(f.on_hand)).toBe(s.onHand);
    expect(r.text).toContain(`${String(s.product)} will run out in about 6 days`);
    expect(r.action).toEqual({
      kind: 'records',
      label: 'See product',
      entity: 'product',
      search: s.product,
    });
  });

  it('finds the regular customer buying less', async () => {
    const s = truth.slippingCustomer!;
    const f = facts(await one(demo, 'customer_slipping', String(s.customer)));
    expect(num(f.recent)).toBeCloseTo(Number(s.spendLast60Days), 2);
    expect(num(f.usual)).toBeCloseTo(Number(s.averageSpendPer60DaysBefore), 2);
    expect(num(f.drop_pct) * 100).toBeCloseTo(Number(s.dropPct), 1);
    expect(num(f.days_since)).toBe(s.daysSinceLastOrder);
  });

  it('shows the AI’s rewording when it passes the checks, filled by code', async () => {
    const r = await one(demo, 'customer_slipping', 'Bloom & Co');
    expect(r.phrasedBy).toBe('phrase_insights@v1');
    expect(r.text).toBe(
      'Bloom & Co is spending less: down 66.4% on their usual, and their last order was 41 days ago.',
    );
    // The pack's bold comes back on the customer.
    expect(r.headline[0]).toEqual({ text: 'Bloom & Co', bold: true, fact: 'customer' });
    // Later runs refill it with fresh facts, with no new AI call.
    await runInsights(demo.member, { trigger: 'daily', now: NOW, provider: null });
    expect((await one(demo, 'customer_slipping', 'Bloom & Co')).text).toBe(r.text);
  });

  it('finds the dead stock, valued exactly', async () => {
    const s = truth.deadStock!;
    const r = await one(demo, 'dead_stock');
    const f = facts(r);
    expect(num(f.count)).toBe(s.count);
    expect(exact(f.value)).toBe(s.totalValueAtCost);
    expect(txt(f.top_product)).toBe(s.top);
    expect(r.level).toBe('warn');
  });

  it('finds the margin squeeze from supplier costs', async () => {
    const s = truth.marginSqueeze!;
    const f = facts(await one(demo, 'margin_squeeze', String(s.product)));
    expect(num(f.old_cost)).toBe(s.costBefore);
    expect(num(f.new_cost)).toBe(s.costAfter);
    expect(num(f.price)).toBe(s.price);
    expect(num(f.cost_change) * 100).toBeCloseTo(Number(s.costChangePct), 0);
    expect(num(f.old_margin) * 100).toBeCloseTo(Number(s.marginBeforePct), 1);
    expect(num(f.new_margin) * 100).toBeCloseTo(Number(s.marginAfterPct), 0);
  });

  it('finds the return spike with its top reason', async () => {
    const s = truth.returnSpike!;
    const f = facts(await one(demo, 'return_spike', String(s.product)));
    // Counted on the day items came back (the pack's return rate), which is what files show.
    expect(num(f.returned)).toBe(s.unitsReturnedByReturnDate);
    expect(num(f.return_rate) * 100).toBeCloseTo(Number(s.returnRateByReturnDatePct), 1);
    expect(txt(f.top_reason)).toBe(s.topReason);
  });

  it('finds the channel shift, named the way people say it', async () => {
    const s = truth.channelShift!;
    const r = await one(demo, 'channel_shift', String(s.channel));
    const f = facts(r);
    expect(txt(f.channel)).toBe('Etsy');
    expect(num(f.share) * 100).toBeCloseTo(Number(s.sharePctLast90DaysNetOfRefunds), 1);
    expect(num(f.prev_share) * 100).toBeCloseTo(Number(s.sharePctPrior90DaysNetOfRefunds), 1);
  });

  it('finds the overdue payments, with the biggest debtor', async () => {
    const s = truth.overduePayments!;
    const byCustomer = s.byCustomerAsInvoiced as Record<
      string,
      { amount: number; daysLate: number }
    >;
    const [largest, worst] = Object.entries(byCustomer).sort(
      (a, b) => b[1].amount - a[1].amount,
    )[0]!;
    const f = facts(await one(demo, 'overdue_payments'));
    expect(num(f.count)).toBe(Object.keys(byCustomer).length);
    expect(exact(f.amount)).toBe(s.totalAsInvoiced);
    expect(txt(f.customer)).toBe(largest);
    expect(num(f.customer_amount)).toBe(worst.amount);
    expect(num(f.days)).toBe(worst.daysLate);
  });

  it('spots the rising star too', async () => {
    const s = truth.risingStar!;
    const f = facts(await one(demo, 'rising_star', String(s.product)));
    expect(num(f.units)).toBe(s.unitsLast28Days);
    expect(num(f.before)).toBe(s.unitsPrior28Days);
  });

  it('raises no urgent alert, and none of the planted stories, on the control business', async () => {
    const rows = await rowsOf(control);
    expect(rows.filter((r) => r.level === 'urgent')).toEqual([]);
    const storyRules = [
      'stockout_risk',
      'dead_stock',
      'customer_slipping',
      'margin_squeeze',
      'return_spike',
      'channel_shift',
      'overdue_payments',
    ];
    expect(rows.filter((r) => storyRules.includes(r.ruleId)).map((r) => r.text)).toEqual([]);
  });

  it('puts the most urgent first on Home and writes the weekly digest', async () => {
    const home = await getInsights(demo.member, { limit: 5, now: NOW });
    expect(home.insights).toHaveLength(5);
    expect(home.insights[0]!.ruleId).toBe('stockout_risk');
    expect(home.stale).toBe(false);
    expect(home.waitingForHistory).toBe(false);
    expect(home.lastRun?.historyDays).toBeGreaterThan(300);
    // A new day means a new "last 7 days": Home asks for a fresh run.
    const tomorrow = new Date(NOW.getTime() + 86_400_000);
    expect((await getInsights(demo.member, { now: tomorrow })).stale).toBe(true);

    const [d] = await getAppDb()
      .select()
      .from(digest)
      .where(eq(digest.workspaceId, demo.member.workspace.id));
    const content = d!.content as DigestContent;
    expect(content.weekOf).toBe('2026-10-12'); // the Monday of the demo's week
    expect(content.period).toEqual({ from: '2026-10-05', to: '2026-10-12' });
    expect(content.kpis.map((k) => k.label)).toEqual(['Net sales', 'Orders']);
    expect(content.insights).toHaveLength(3);
    expect(content.question).toBeTruthy();
  });

  it('keeps insights across runs, honours dismissals and brings back what got worse', async () => {
    const m = demo.member;
    const again = await runInsights(m, { trigger: 'daily', now: NOW, provider: null });
    expect(again.created).toBe(0);
    expect(again.resolved).toBe(0);

    // Dismissed: hidden while it holds.
    const dead = await one(demo, 'dead_stock');
    await dismissInsight(m, demo.ownerId, dead.id, { notUseful: true });
    await expect(dismissInsight(m, demo.ownerId, dead.id)).rejects.toThrow(InsightError);
    await runInsights(m, { trigger: 'daily', now: NOW, provider: null });
    expect(await one(demo, 'dead_stock')).toMatchObject({
      status: 'dismissed',
      feedback: 'not_useful',
    });

    // Less urgent (the owner only wants "urgent" within 3 days), dismissed, then urgent again.
    const stockout = async () => one(demo, 'stockout_risk', 'Sage Stoneware Mug');
    const thresholds = { warn_days: 14, urgent_days: 3 };
    await saveAlertSetting(m, demo.ownerId, 'stockout_risk', { enabled: true, thresholds });
    await runInsights(m, { trigger: 'settings', now: NOW, provider: null });
    expect((await stockout()).level).toBe('warn');
    await dismissInsight(m, demo.ownerId, (await stockout()).id);
    await runInsights(m, { trigger: 'daily', now: NOW, provider: null });
    expect((await stockout()).status).toBe('dismissed');
    await saveAlertSetting(m, demo.ownerId, 'stockout_risk', {
      enabled: true,
      thresholds: { ...thresholds, urgent_days: 7 },
    });
    await runInsights(m, { trigger: 'settings', now: NOW, provider: null });
    expect(await stockout()).toMatchObject({ level: 'urgent', status: 'new', dismissedAt: null });

    // Switched off: resolved. Back on: it comes back.
    await saveAlertSetting(m, demo.ownerId, 'channel_shift', { enabled: false, thresholds: {} });
    const off = await runInsights(m, { trigger: 'settings', now: NOW, provider: null });
    expect(off.rules.find((r) => r.id === 'channel_shift')).toMatchObject({ status: 'skipped' });
    expect((await one(demo, 'channel_shift', 'etsy')).status).toBe('resolved');
    await saveAlertSetting(m, demo.ownerId, 'channel_shift', { enabled: true, thresholds: {} });
    await runInsights(m, { trigger: 'settings', now: NOW, provider: null });
    expect((await one(demo, 'channel_shift', 'etsy')).status).toBe('new');
    const active = await getAppDb()
      .select({ id: insight.id })
      .from(insight)
      .where(and(eq(insight.workspaceId, m.workspace.id), eq(insight.status, 'new')));
    expect(active.length).toBeGreaterThan(5);
  });

  it('shows alert settings in the units people think in, and refuses silly numbers', async () => {
    const settings = await getAlertSettings(demo.member);
    const slipping = settings.find((s) => s.ruleId === 'customer_slipping')!;
    expect(slipping.thresholds.find((t) => t.name === 'drop')).toMatchObject({
      before: 'Tell me when a regular customer’s spending drops by'.replace('’', "'"),
      after: '% or more',
      value: 50,
      unit: 'percent',
    });
    await expect(
      saveAlertSetting(demo.member, demo.ownerId, 'customer_slipping', {
        enabled: true,
        thresholds: { drop: 500 },
      }),
    ).rejects.toThrow(/from 10 to 95/);
  });
});
