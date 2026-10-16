import {
  NAPKIN_COST_AFTER,
  NAPKIN_COST_BEFORE,
  NAPKIN_PRICE,
  STOCKISTS,
  STORY,
  type Cents,
  type Product,
} from './catalog';
import { daysBetween, type IsoDate } from './dates';
import { type Channel, type Sale, type Simulation } from './simulate';
import { saleTotal, type SheetReport } from './writers';

/**
 * The answer key for the demo dataset: clean records plus the expected numbers for every planted
 * story. Ingestion evals compare against `counts` and `entities`; metric and insight tests compare
 * against `stories`. Definitions are written next to each number so later code can match them.
 */
export interface GroundTruth {
  meta: { today: IsoDate; start: IsoDate; seed: number; currency: 'USD'; generator: string };
  files: SheetReport[];
  counts: Record<string, number | Record<string, number>>;
  entities: {
    products: {
      sku: string;
      skuListed: boolean;
      name: string;
      category: string;
      price: number;
      cost: number;
      supplier: string;
      stockOnHand: number;
      reorderAt: number;
      discontinued: boolean;
    }[];
    stockists: { name: string; spellings: string[] }[];
  };
  stories: Record<string, Record<string, unknown>>;
}

const dollars = (c: Cents) => Math.round(c) / 100;
const pct = (x: number) => Math.round(x * 1000) / 10;

function lineNet(sale: Sale): Cents {
  return sale.lines.reduce((t, l) => t + l.qty * l.unitPrice - l.discount, 0);
}

export function buildTruth(sim: Simulation, files: SheetReport[], seed: number): GroundTruth {
  const completed = sim.sales.filter((s) => s.status === 'completed');
  const ago = (d: IsoDate) => daysBetween(d, sim.today);
  const byName = (name: string) => sim.products.find((p) => p.name === name)!;

  const unitsBetween = (p: Product, fromAgo: number, toAgo: number) =>
    completed
      .filter((s) => ago(s.date) <= fromAgo && ago(s.date) > toAgo)
      .reduce(
        (t, s) => t + s.lines.filter((l) => l.product === p).reduce((u, l) => u + l.qty, 0),
        0,
      );

  // Stock-out risk: units sold in the last 28 days ÷ 28 = daily rate; days of cover = on hand ÷ rate.
  const mug = byName(STORY.stockout);
  const mugUnits28 = unitsBetween(mug, 28, 0);
  const mugRate = mugUnits28 / 28;
  const mugOnHand = sim.stockOnHand.get(mug)!;

  // Dead stock: on hand > 0 and no completed sale in the last 90 days. Value at stock-list cost.
  const lastSold = new Map<Product, IsoDate>();
  for (const s of completed) for (const l of s.lines) lastSold.set(l.product, s.date);
  const dead = sim.products
    .filter((p) => (sim.stockOnHand.get(p) ?? 0) > 0)
    .filter((p) => !lastSold.has(p) || ago(lastSold.get(p)!) > 90)
    .map((p) => ({
      name: p.name,
      onHand: sim.stockOnHand.get(p)!,
      value: dollars(sim.stockOnHand.get(p)! * p.cost),
    }))
    .sort((a, b) => b.value - a.value);

  // Slipping stockist: spend in the last 60 days vs. average 60-day spend over the 6 months before.
  const bloom = completed.filter((s) => s.stockist?.name === STORY.slippingStockist);
  const bloomRecent = bloom.filter((s) => ago(s.date) <= 60).reduce((t, s) => t + lineNet(s), 0);
  const bloomBefore =
    bloom
      .filter((s) => ago(s.date) > 60 && ago(s.date) <= 240)
      .reduce((t, s) => t + lineNet(s), 0) / 3;
  const bloomLast = bloom.at(-1)!;

  // Return spike: units returned ÷ units sold for the carafe, last 60 days (by sale date).
  const carafe = byName(STORY.returnSpike);
  const carafeSold60 = unitsBetween(carafe, 60, 0);
  const carafeReturned60 = sim.returns
    .filter((r) => r.product === carafe && ago(r.sale.date) <= 60)
    .reduce((t, r) => t + r.qty, 0);
  // The same, counting returns on the day they came back (the pack's return rate): this is what an
  // owner's own files can show, since a returns log rarely says which sale an item came from.
  const carafeReturnedByDate60 = sim.returns
    .filter((r) => r.product === carafe && ago(r.date) <= 60 && ago(r.date) > 0)
    .reduce((t, r) => t + r.qty, 0);

  // Rising star: units in the last 28 days vs the 28 days before.
  const pot = byName(STORY.risingStar);
  const potRecent = unitsBetween(pot, 28, 0);
  const potPrior = unitsBetween(pot, 56, 28);

  // Channel shift: share of line net sales (after discounts, before returns) by channel.
  const share = (fromAgo: number, toAgo: number) => {
    const totals = new Map<Channel, number>();
    let all = 0;
    for (const s of completed.filter((x) => ago(x.date) <= fromAgo && ago(x.date) > toAgo)) {
      totals.set(s.channel, (totals.get(s.channel) ?? 0) + lineNet(s));
      all += lineNet(s);
    }
    return Object.fromEntries([...totals].map(([c, v]) => [c, pct(v / all)]));
  };
  const shareRecent = share(90, 0);
  const sharePrior = share(180, 90);
  // The same after refunds, counted on the day of the return (the pack's net sales). Till refunds
  // aren't linked to a sale, so they have no channel and stay out of the shares.
  const shareNet = (fromAgo: number, toAgo: number) => {
    const totals = new Map<Channel, number>();
    const inWindow = (d: IsoDate) => ago(d) <= fromAgo && ago(d) > toAgo;
    for (const s of completed.filter((x) => inWindow(x.date)))
      totals.set(s.channel, (totals.get(s.channel) ?? 0) + lineNet(s));
    for (const r of sim.returns.filter((x) => !x.viaTill && inWindow(x.date)))
      totals.set(r.sale.channel, (totals.get(r.sale.channel) ?? 0) - r.refund * r.qty);
    const all = [...totals.values()].reduce((a, b) => a + b, 0);
    return Object.fromEntries([...totals].map(([c, v]) => [c, pct(v / all)]));
  };

  // Overdue payments: wholesale invoices past their due date (invoice date + 30) not fully paid.
  const overdue = completed
    .filter(
      (s) =>
        s.channel === 'wholesale' && s.dueDate && s.dueDate < sim.today && s.payment !== 'paid',
    )
    .map((s) => ({
      customer: s.stockist!.name,
      invoice: s.number,
      owed: dollars(saleTotal(s) - s.amountPaid),
      invoiced: dollars(saleTotal(s)),
      daysLate: daysBetween(s.dueDate!, sim.today),
    }));
  // What the files can show: invoices carry a "Paid?" flag but not how much of a part-paid one came
  // in, so those count in full.
  const overdueByCustomer = new Map<string, { amount: number; daysLate: number }>();
  for (const o of overdue) {
    const c = overdueByCustomer.get(o.customer) ?? { amount: 0, daysLate: 0 };
    c.amount = Math.round((c.amount + o.invoiced) * 100) / 100;
    c.daysLate = Math.max(c.daysLate, o.daysLate);
    overdueByCustomer.set(o.customer, c);
  }

  const napkin = byName(STORY.marginSqueeze);
  const margin = (cost: Cents) => pct((NAPKIN_PRICE - cost) / NAPKIN_PRICE);

  const channelCounts: Record<string, number> = {};
  for (const s of sim.sales) channelCounts[s.channel] = (channelCounts[s.channel] ?? 0) + 1;

  const etsyBuyers = new Set(
    completed.filter((s) => s.channel === 'etsy').map((s) => s.customer?.name),
  );
  const webCustomers = new Set(
    completed.filter((s) => s.channel === 'online_store').map((s) => s.customer?.email),
  );
  const namedCustomers = new Set(sim.sales.filter((s) => s.customer).map((s) => s.customer!.name));

  const expenseEntries = sim.expenses.reduce(
    (t, r) => t + [...r.byMonth.values()].filter((v) => v > 0).length,
    0,
  );
  const adsThisYear = sim.expenses
    .filter((r) => r.category.startsWith('Advertising'))
    .reduce((t, r) => t + [...r.byMonth.values()].reduce((a, b) => a + b, 0), 0);

  return {
    meta: {
      today: sim.today,
      start: sim.start,
      seed,
      currency: 'USD',
      generator: '@bizr/demo-data@1',
    },
    files,
    counts: {
      products: sim.products.length,
      productsWithoutListedSku: sim.products.filter((p) => !p.skuListed).length,
      categories: new Set(sim.products.map((p) => p.category)).size,
      suppliers: new Set(sim.products.map((p) => p.supplier)).size,
      sales: sim.sales.length,
      salesByChannel: channelCounts,
      cancelledSales: sim.sales.filter((s) => s.status === 'cancelled').length,
      saleLines: sim.sales.reduce((t, s) => t + s.lines.length, 0),
      namedCustomers: namedCustomers.size,
      websiteCustomersByEmail: webCustomers.size,
      etsyBuyers: etsyBuyers.size,
      stockists: STOCKISTS.length,
      returns: sim.returns.length,
      returnsViaTill: sim.returns.filter((r) => r.viaTill).length,
      purchases: sim.purchases.length,
      purchaseLines: sim.purchases.reduce((t, p) => t + p.lines.length, 0),
      expenseEntries,
    },
    entities: {
      products: sim.products.map((p) => ({
        sku: p.sku,
        skuListed: p.skuListed,
        name: p.name,
        category: p.category,
        price: dollars(p.price),
        cost: dollars(p.cost),
        supplier: p.supplier,
        stockOnHand: sim.stockOnHand.get(p) ?? 0,
        reorderAt: p.reorderAt,
        discontinued: p.discontinued,
      })),
      stockists: STOCKISTS.map((s) => ({ name: s.name, spellings: s.spellings })),
    },
    stories: {
      stockoutRisk: {
        product: mug.name,
        unitsLast28Days: mugUnits28,
        dailyRate: Math.round(mugRate * 100) / 100,
        onHand: mugOnHand,
        daysOfCover: Math.round((mugOnHand / mugRate) * 10) / 10,
        definition: 'on hand ÷ (units sold in the last 28 days ÷ 28)',
      },
      slippingCustomer: {
        customer: STORY.slippingStockist,
        spendLast60Days: dollars(bloomRecent),
        averageSpendPer60DaysBefore: dollars(bloomBefore),
        dropPct: pct(1 - bloomRecent / bloomBefore),
        daysSinceLastOrder: ago(bloomLast.date),
        definition:
          'net line spend in the last 60 days vs average 60-day spend over the 180 days before that',
      },
      deadStock: {
        products: dead,
        count: dead.length,
        totalValueAtCost: Math.round(dead.reduce((t, d) => t + d.value, 0) * 100) / 100,
        top: dead[0]?.name,
        definition:
          'on hand > 0 and no completed sale in the last 90 days; value = on hand × stock-list cost',
      },
      marginSqueeze: {
        product: napkin.name,
        price: dollars(NAPKIN_PRICE),
        costBefore: dollars(NAPKIN_COST_BEFORE),
        costAfter: dollars(NAPKIN_COST_AFTER),
        costChangePct: pct(NAPKIN_COST_AFTER / NAPKIN_COST_BEFORE - 1),
        marginBeforePct: margin(NAPKIN_COST_BEFORE),
        marginAfterPct: margin(NAPKIN_COST_AFTER),
        costChangedOn: firstDateWithCost(sim, napkin, NAPKIN_COST_AFTER),
        definition: 'supplier unit cost from supplier orders; margin = (price − cost) ÷ price',
      },
      returnSpike: {
        product: carafe.name,
        unitsSoldLast60Days: carafeSold60,
        unitsReturned: carafeReturned60,
        returnRatePct: pct(carafeReturned60 / carafeSold60),
        unitsReturnedByReturnDate: carafeReturnedByDate60,
        returnRateByReturnDatePct: pct(carafeReturnedByDate60 / carafeSold60),
        topReason: 'Arrived broken',
        definition: 'units returned ÷ units sold, for sales in the last 60 days',
        definitionByReturnDate:
          'units returned in the last 60 days ÷ units sold in the last 60 days',
      },
      risingStar: {
        product: pot.name,
        unitsLast28Days: potRecent,
        unitsPrior28Days: potPrior,
        changePct: pct(potRecent / potPrior - 1),
      },
      channelShift: {
        channel: 'etsy',
        sharePctLast90Days: shareRecent.etsy,
        sharePctPrior90Days: sharePrior.etsy,
        sharesLast90Days: shareRecent,
        sharesPrior90Days: sharePrior,
        definition: 'share of net line sales (after discounts) by channel',
        sharePctLast90DaysNetOfRefunds: shareNet(90, 0).etsy,
        sharePctPrior90DaysNetOfRefunds: shareNet(180, 90).etsy,
        definitionNetOfRefunds:
          'the same after refunds on the day of the return; till refunds have no channel',
      },
      overduePayments: {
        invoices: overdue,
        customers: [...new Set(overdue.map((o) => o.customer))],
        totalOwed: Math.round(overdue.reduce((t, o) => t + o.owed, 0) * 100) / 100,
        byCustomerAsInvoiced: Object.fromEntries(overdueByCustomer),
        totalAsInvoiced: Math.round(overdue.reduce((t, o) => t + o.invoiced, 0) * 100) / 100,
        definitionAsInvoiced:
          'invoice totals past due and not marked paid; part-paid invoices count in full',
      },
      advertisingThisYear: {
        total: dollars(adsThisYear),
        categories: ['Advertising - Meta', 'Advertising - Etsy'],
      },
    },
  };
}

function firstDateWithCost(sim: Simulation, product: Product, cost: Cents): IsoDate | null {
  const po = sim.purchases.find((p) =>
    p.lines.some((l) => l.product === product && l.unitCost === cost),
  );
  return po ? po.orderDate : null;
}
