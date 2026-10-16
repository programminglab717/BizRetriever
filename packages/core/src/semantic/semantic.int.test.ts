import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { closePools, getAppDb, user } from '@bizr/db';
import {
  generateDemoDataset,
  simulateDemo,
  type GroundTruth,
  type Sale,
  type Simulation,
} from '@bizr/demo-data';
import { getPack } from '@bizr/packs';
import { databaseAvailable } from '@bizr/platform/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyChangePlan, loadCatalog } from '../change-plan/apply';
import { planFromPack } from '../change-plan/from-pack';
import { executeTenantQuery, type TenantRef } from '../executor/execute';
import { withTenantWriter } from '../executor/write';
import { analyzeFiles } from '../ingestion/analyze';
import { proposeHeuristically } from '../ingestion/heuristic';
import { loadRecords } from '../ingestion/load';
import { materialize } from '../ingestion/materialize';
import { entitySpecs } from '../ingestion/pipeline';
import {
  createWorkspace,
  deleteWorkspace,
  getMemberWorkspace,
  type MemberWorkspace,
} from '../workspaces/service';
import { compileQuery } from './compile';
import { SemanticError } from './graph';
import { fieldsWithData } from './data';
import { buildModel, type CompileContext, type SemanticModel } from './model';
import type { QuerySpecInput } from './query-spec';

/**
 * M3 acceptance: every retail metric, run on the demo data loaded the normal way, matches values
 * computed by hand from the simulated business behind the demo files. Products written differently
 * on the till export ("Sage Mug") don't link to a product, so product-based checks use online-store
 * sales, where every item carries its code.
 */
const hasDb = await databaseAvailable();
const TODAY = '2026-10-13';
const SEP = { from: '2026-09-01', to: '2026-10-01' };
const AUG = { from: '2026-08-01', to: '2026-09-01' };
const ctx: CompileContext = {
  timezone: 'America/New_York',
  weekStart: 1,
  fiscalYearStartMonth: 1,
  today: TODAY,
};
const pack = getPack('retail');

function userError(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof SemanticError) return err.userMessage;
    throw err;
  }
  return '';
}

// --- hand calculations over the simulation (cents) ----------------------------------------------

const inP = (d: string, p: { from: string; to: string }) => d >= p.from && d < p.to;
const gross = (s: Sale) => s.lines.reduce((t, l) => t + l.qty * l.unitPrice, 0);
const lineNet = (s: Sale) => s.lines.reduce((t, l) => t + l.qty * l.unitPrice - l.discount, 0);
const who = (s: Sale) => s.customer?.name ?? s.stockist?.name;
const dollars = (c: number) => c / 100;

function hand(sim: Simulation) {
  const done = sim.sales.filter((s) => s.status === 'completed');
  const sales = (p: { from: string; to: string }, f: (s: Sale) => boolean = () => true) =>
    done.filter((s) => inP(s.date, p) && f(s));
  const returns = (p: { from: string; to: string }) => sim.returns.filter((r) => inP(r.date, p));
  return { done, sales, returns };
}

describe.skipIf(!hasDb)('metrics on the demo data (integration)', () => {
  let owner: string;
  let member: MemberWorkspace;
  let tenant: TenantRef;
  let model: SemanticModel;
  let sim: Simulation;
  let truth: GroundTruth;

  const run = async (spec: QuerySpecInput, m: SemanticModel = model) => {
    const q = compileQuery(m, spec, ctx);
    const r = await executeTenantQuery({
      tenant,
      sql: q.sql,
      params: q.params,
      origin: 'system',
      path: 'spec',
      timeoutMs: 20_000,
    });
    return r.rows;
  };
  const one = async (id: string, spec: Omit<QuerySpecInput, 'metrics'> = {}) => {
    const rows = await run({ metrics: [id], ...spec });
    const v = rows[0]?.[`m_${id}`];
    return v === null || v === undefined ? null : Number(v);
  };

  beforeAll(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fernwood-metrics-'));
    truth = await generateDemoDataset({ today: TODAY, seed: 42, outDir: dir });
    sim = simulateDemo({ today: TODAY, seed: 42 });
    const files = readdirSync(dir)
      .filter((f) => f !== 'ground_truth.json')
      .sort()
      .map((fileName) => ({ fileName, bytes: readFileSync(path.join(dir, fileName)) }));

    const [u] = await getAppDb()
      .insert(user)
      .values({ name: 'Metrics', email: `metrics-${crypto.randomUUID()}@example.test` })
      .returning({ id: user.id });
    owner = u!.id;
    const ws = await createWorkspace(owner, {
      name: 'Fernwood Metrics Test',
      packId: 'retail',
      currency: 'USD',
      timezone: ctx.timezone,
      dateOrder: 'MDY',
    });
    member = (await getMemberWorkspace(ws.slug, owner))!;
    tenant = { workspaceId: ws.id, tenantSchema: ws.tenantSchema };

    const analysis = await analyzeFiles(files, { dateOrder: 'MDY', maskPii: true });
    const { proposal } = proposeHeuristically(analysis.profiled, {
      pack,
      dateOrder: 'MDY',
      today: TODAY,
    });
    const used = [...new Set(proposal.sources.flatMap((s) => s.targets.map((t) => t.entity)))];
    await applyChangePlan({
      workspace: { id: ws.id, tenantSchema: ws.tenantSchema },
      plan: planFromPack(pack, used),
      origin: 'system',
    });
    const result = materialize(analysis.tables, proposal, entitySpecs(pack), { dateOrder: 'MDY' });
    const catalog = await loadCatalog(ws.id);
    await withTenantWriter(
      tenant,
      'test load',
      (w) =>
        loadRecords(
          w,
          catalog,
          result,
          files.map(() => crypto.randomUUID()),
        ),
      { timezone: ctx.timezone },
    );
    const { present } = await fieldsWithData(tenant, catalog);
    model = buildModel(catalog, pack, present);
  }, 120_000);

  afterAll(async () => {
    if (member) await deleteWorkspace(member, owner);
    if (owner) await getAppDb().delete(user).where(eq(user.id, owner));
    await closePools();
  });

  it('every retail metric compiles and runs', async () => {
    for (const m of pack.metrics.metrics) {
      const rows = await run({ metrics: [m.id], period: SEP });
      expect(rows, m.id).toHaveLength(1);
    }
  }, 60_000);

  it('sales metrics for a month match the simulation', async () => {
    const h = hand(sim);
    const sep = h.sales(SEP);
    const ret = h.returns(SEP);
    const refunds = ret.reduce((t, r) => t + r.refund * r.qty, 0);
    const units = sep.reduce((t, s) => t + s.lines.reduce((u, l) => u + l.qty, 0), 0);
    const returnedUnits = ret.reduce((t, r) => t + r.qty, 0);
    const net = sep.reduce((t, s) => t + lineNet(s), 0) - refunds;

    expect(await one('gross_sales', { period: SEP })).toBeCloseTo(
      dollars(sep.reduce((t, s) => t + gross(s), 0)),
      2,
    );
    expect(await one('discounts', { period: SEP })).toBeCloseTo(
      dollars(sep.reduce((t, s) => t + s.lines.reduce((d, l) => d + l.discount, 0), 0)),
      2,
    );
    expect(await one('refunds', { period: SEP })).toBeCloseTo(dollars(refunds), 2);
    expect(await one('net_sales', { period: SEP })).toBeCloseTo(dollars(net), 2);
    expect(await one('order_count', { period: SEP })).toBe(sep.length);
    expect(await one('units_sold', { period: SEP })).toBe(units - returnedUnits);
    expect(await one('average_order_value', { period: SEP })).toBeCloseTo(
      dollars(net) / sep.length,
      2,
    );
    expect(await one('customer_count', { period: SEP })).toBe(
      new Set(sep.map(who).filter(Boolean)).size,
    );
    expect(await one('return_rate', { period: SEP })).toBeCloseTo(returnedUnits / units, 6);
  });

  it('breaks net sales down by channel and by month', async () => {
    const h = hand(sim);
    const rows = await run({
      metrics: ['net_sales'],
      dimensions: [{ field: 'sale.channel' }],
      period: SEP,
    });
    const got = Object.fromEntries(rows.map((r) => [String(r.d0), Number(r.m_net_sales)]));
    const want: Record<string, number> = {};
    for (const s of h.sales(SEP)) want[s.channel] = (want[s.channel] ?? 0) + lineNet(s);
    // Till refunds aren't linked to a sale, so they have no channel.
    for (const r of h.returns(SEP)) {
      const key = r.viaTill ? 'null' : r.sale.channel;
      want[key] = (want[key] ?? 0) - r.refund * r.qty;
    }
    expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
    for (const [k, v] of Object.entries(want)) expect(got[k], k).toBeCloseTo(dollars(v), 2);

    const Q3 = { from: '2026-07-01', to: '2026-10-01' };
    const monthly = await run({
      metrics: ['order_count'],
      dimensions: [{ time: 'month' }],
      period: Q3,
    });
    expect(
      monthly.map((r) =>
        String(r.d0 instanceof Date ? r.d0.toISOString().slice(0, 7) : r.d0).slice(0, 7),
      ),
    ).toEqual(['2026-07', '2026-08', '2026-09']);
    for (const r of monthly) {
      const ym = (r.d0 instanceof Date ? r.d0.toISOString() : String(r.d0)).slice(0, 7);
      expect(Number(r.m_order_count), ym).toBe(h.sales(Q3, (s) => s.date.startsWith(ym)).length);
    }
  });

  it('compares with the previous period', async () => {
    const h = hand(sim);
    const rows = await run({ metrics: ['order_count'], period: SEP, compare: 'previous_period' });
    expect(Number(rows[0]!.m_order_count)).toBe(h.sales(SEP).length);
    expect(Number(rows[0]!.m_order_count__prev)).toBe(h.sales(AUG).length);

    // With a breakdown: every channel from either month, each paired with its own earlier value.
    const byChannel = await run({
      metrics: ['order_count'],
      dimensions: [{ field: 'sale.channel' }],
      period: SEP,
      compare: 'previous_period',
    });
    const channels = new Set([...h.sales(SEP), ...h.sales(AUG)].map((s) => s.channel));
    expect(byChannel.map((r) => r.d0).sort()).toEqual([...channels].sort());
    for (const r of byChannel) {
      const ch = String(r.d0);
      expect(Number(r.m_order_count ?? 0), ch).toBe(h.sales(SEP, (s) => s.channel === ch).length);
      expect(Number(r.m_order_count__prev ?? 0), ch).toBe(
        h.sales(AUG, (s) => s.channel === ch).length,
      );
    }
  });

  it('breaks online-store sales and profit down by category', async () => {
    const h = hand(sim);
    const online = { field: 'sale.channel', op: 'eq' as const, value: 'online_store' };
    const rows = await run({
      metrics: ['net_sales', 'cogs'],
      dimensions: [{ field: 'product.category' }],
      filters: [online],
      period: SEP,
    });
    const net: Record<string, number> = {};
    const cost: Record<string, number> = {};
    for (const s of h.sales(SEP, (x) => x.channel === 'online_store')) {
      // Order discounts are shared across items in proportion to their price (metric definition).
      const g = gross(s);
      const orderDiscount = s.lines.reduce((t, l) => t + l.discount, 0);
      for (const l of s.lines) {
        const c = l.product.category;
        const share = g ? (orderDiscount * l.qty * l.unitPrice) / g : 0;
        net[c] = (net[c] ?? 0) + l.qty * l.unitPrice - share;
        cost[c] = (cost[c] ?? 0) + l.qty * l.product.cost;
      }
    }
    for (const r of h.returns(SEP).filter((x) => !x.viaTill && x.sale.channel === 'online_store')) {
      const c = r.product.category;
      net[c] = (net[c] ?? 0) - r.refund * r.qty;
      cost[c] = (cost[c] ?? 0) - r.qty * r.product.cost;
    }
    const got = Object.fromEntries(rows.map((r) => [String(r.d0), r]));
    expect(Object.keys(got).sort()).toEqual(Object.keys(net).sort());
    for (const c of Object.keys(net)) {
      expect(Number(got[c]!.m_net_sales), c).toBeCloseTo(dollars(net[c]!), 1);
      expect(Number(got[c]!.m_cogs), c).toBeCloseTo(dollars(cost[c]!), 1);
    }
  });

  it('stock metrics match the stock list', async () => {
    const asOf = { from: '2026-01-01', to: TODAY };
    let onHand = 0;
    let value = 0;
    for (const [p, n] of sim.stockOnHand) {
      onHand += n;
      value += n * p.cost;
    }
    expect(await one('stock_on_hand', { period: asOf })).toBe(onHand);
    expect(await one('stock_value', { period: asOf })).toBeCloseTo(dollars(value), 2);
    expect(await one('dead_stock_value', { period: asOf })).toBeCloseTo(
      truth.stories.deadStock!.totalValueAtCost as number,
      2,
    );

    // Days of cover for the mug, from its online sales (see the note at the top).
    const mug = truth.stories.stockoutRisk!.product as string;
    const h = hand(sim);
    const units28 = h.done
      .filter((s) => s.channel === 'online_store' && s.date >= '2026-09-15' && s.date < TODAY)
      .reduce(
        (t, s) => t + s.lines.filter((l) => l.product.name === mug).reduce((u, l) => u + l.qty, 0),
        0,
      );
    const filters = [
      { field: 'product.name', op: 'eq' as const, value: mug },
      { field: 'sale.channel', op: 'eq' as const, value: 'online_store' },
    ];
    const rows = await run({ metrics: ['daily_sales_rate'], filters, period: asOf });
    expect(Number(rows[0]!.m_daily_sales_rate)).toBeCloseTo(units28 / 28, 6);
  });

  it('customer metrics match the simulation', async () => {
    const h = hand(sim);
    const first = new Map<string, string>();
    const orders = new Map<string, string[]>();
    for (const s of h.done) {
      const k = who(s);
      if (!k) continue;
      if (!first.has(k) || s.date < first.get(k)!) first.set(k, s.date);
      orders.set(k, [...(orders.get(k) ?? []), s.date]);
    }
    const newInSep = [...first.values()].filter((d) => inP(d, SEP)).length;
    expect(await one('new_customers', { period: SEP })).toBe(newInSep);

    const buyers = new Set(h.sales(SEP).map(who).filter(Boolean) as string[]);
    const returning = [...buyers].filter((b) => first.get(b)! < SEP.from).length;
    expect(await one('repeat_customer_rate', { period: SEP })).toBeCloseTo(
      returning / buyers.size,
      6,
    );

    const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
    let lapsed = 0;
    for (const dates of orders.values()) {
      const before = dates.filter((d) => d < TODAY).sort();
      if (before.length < 3) continue;
      const since = day(TODAY) - day(before.at(-1)!);
      const gap = (day(before.at(-1)!) - day(before[0]!)) / (before.length - 1);
      if (since > 30 && since > 2 * gap) lapsed += 1;
    }
    expect(await one('lapsed_customers', { period: { from: '2026-01-01', to: TODAY } })).toBe(
      lapsed,
    );
  });

  it('money owed, expenses and supplier spend match', async () => {
    const h = hand(sim);
    const owed = h.done.filter((s) => s.payment === 'unpaid' || s.payment === 'partial');
    const asOf = { from: '2026-01-01', to: TODAY };
    expect(await one('outstanding_receivables', { period: asOf })).toBeCloseTo(
      dollars(owed.filter((s) => s.date < TODAY).reduce((t, s) => t + lineNet(s), 0)),
      2,
    );
    expect(await one('overdue_receivables', { period: asOf })).toBeCloseTo(
      dollars(
        owed
          .filter((s) => s.date < TODAY && s.dueDate && s.dueDate < TODAY)
          .reduce((t, s) => t + lineNet(s), 0),
      ),
      2,
    );

    const sepExpenses = sim.expenses.reduce(
      (t, r) => t + (sim.expenseYear === 2026 ? (r.byMonth.get(9) ?? 0) : 0),
      0,
    );
    expect(await one('expenses_total', { period: SEP })).toBeCloseTo(dollars(sepExpenses), 2);

    const spend = sim.purchases
      .filter((p) => inP(p.orderDate, SEP))
      .reduce((t, p) => t + p.lines.reduce((u, l) => u + l.qty * l.unitCost, 0), 0);
    expect(await one('supplier_spend', { period: SEP })).toBeCloseTo(dollars(spend), 2);
  });

  it('marks metrics unavailable, with a reason, when costs or stock are missing', async () => {
    const without = (refs: string[]) => {
      const present = new Set(model.present);
      for (const r of refs) present.delete(r);
      return buildModel(model.entities, pack, present);
    };
    const noCosts = without(['product.unit_cost', 'sale_line.unit_cost_at_sale']);
    expect(userError(() => compileQuery(noCosts, { metrics: ['gross_profit'] }, ctx))).toMatch(
      /costs you/,
    );
    // Net sales doesn't need costs.
    expect(await one('net_sales', { period: SEP })).not.toBeNull();
    await expect(run({ metrics: ['net_sales'], period: SEP }, noCosts)).resolves.toHaveLength(1);

    const noStock = without(['stock_count.quantity_on_hand']);
    expect(userError(() => compileQuery(noStock, { metrics: ['days_of_cover'] }, ctx))).toMatch(
      /stock list/,
    );

    // Without returns, net sales is just sales after discounts.
    const noReturns = without(['return.refund_amount', 'return.quantity']);
    const rows = await run({ metrics: ['net_sales'], period: SEP }, noReturns);
    const h = hand(sim);
    expect(Number(rows[0]!.m_net_sales)).toBeCloseTo(
      dollars(h.sales(SEP).reduce((t, s) => t + lineNet(s), 0)),
      2,
    );
  });
});
