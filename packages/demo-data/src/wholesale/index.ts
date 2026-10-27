import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { addDays, daysBetween, type IsoDate } from '../dates';
import type { SheetReport } from '../writers';
import { writeWholesaleFiles } from './files';
import {
  invoiceNet,
  simulateWholesale,
  WHOLESALE_STORY,
  type WholesaleSimulation,
} from './simulate';

export { simulateWholesale, WHOLESALE_STORY, type WholesaleSimulation } from './simulate';

/**
 * The answer key for the wholesale demo (M14): record counts for the import, and every planted
 * story's numbers worked out from the simulation by the same definitions as the pack's measures.
 */
export interface WholesaleTruth {
  meta: { today: IsoDate; start: IsoDate; seed: number; currency: 'USD'; generator: string };
  files: SheetReport[];
  counts: Record<string, number>;
  stories: Record<string, Record<string, unknown>>;
}

const dollars = (c: number) => Math.round(c) / 100;
const within = (d: IsoDate, today: IsoDate, from: number, to = 0) => {
  const ago = daysBetween(d, today);
  return ago <= from && ago > to;
};

export function wholesaleTruth(
  sim: WholesaleSimulation,
  files: SheetReport[],
  seed: number,
): WholesaleTruth {
  const t = sim.today;
  const of = (name: string) => sim.invoices.filter((i) => i.customer.name === name);
  const owed = (name: string) =>
    of(name)
      .filter((i) => !i.paidOn)
      .reduce((a, i) => a + invoiceNet(i), 0);
  const payDays = (name: string, from: number, to: number) => {
    const ps = sim.payments.filter(
      (p) => p.invoice.customer.name === name && within(p.date, t, from, to),
    );
    return ps.length
      ? Math.round(ps.reduce((a, p) => a + daysBetween(p.invoice.date, p.date), 0) / ps.length)
      : null;
  };
  const spend = (name: string, from: number, to = 0) =>
    of(name)
      .filter((i) => within(i.date, t, from, to))
      .reduce((a, i) => a + invoiceNet(i), 0);
  const seaside = of(WHOLESALE_STORY.missedReorder);
  const first = seaside[0]!.date;
  const last = seaside.at(-1)!.date;
  const sold28 = (name: string) =>
    sim.invoices
      .filter((i) => within(i.date, t, 28))
      .flatMap((i) => i.lines)
      .filter((l) => l.product.name === name);
  const beans = sim.products.find((p) => p.name === WHOLESALE_STORY.stockout)!;
  const beansRate = sold28(beans.name).reduce((a, l) => a + l.qty, 0) / 28;
  const corner = sim.customers.find((c) => c.name === WHOLESALE_STORY.overCredit)!;
  const cups = sim.purchases.filter((l) => l.product.name === WHOLESALE_STORY.costRise);
  const overdue = sim.invoices.filter((i) => !i.paidOn && i.due < t);
  const before = spend(WHOLESALE_STORY.slipping, 240, 60) / 3;
  const recent = spend(WHOLESALE_STORY.slipping, 60);

  return {
    meta: { today: t, start: sim.start, seed, currency: 'USD', generator: 'harbour-pine@1' },
    files,
    counts: {
      sale: sim.invoices.length,
      sale_line: sim.invoices.reduce((a, i) => a + i.lines.length, 0),
      customer: sim.customers.length,
      payment: sim.payments.length,
      product: sim.products.length,
      supplier: sim.suppliers.length,
      purchase: new Set(sim.purchases.map((l) => l.po)).size,
      purchase_line: sim.purchases.length,
    },
    stories: {
      overCredit: {
        customer: corner.name,
        owed: dollars(owed(corner.name)),
        creditLimit: dollars(corner.creditLimit),
      },
      payingLater: {
        customer: WHOLESALE_STORY.payingLater,
        daysBefore: payDays(WHOLESALE_STORY.payingLater, 180, 90),
        daysLast90: payDays(WHOLESALE_STORY.payingLater, 90, 0),
      },
      missedReorder: {
        customer: WHOLESALE_STORY.missedReorder,
        usualGapDays: Math.round(daysBetween(first, last) / (seaside.length - 1)),
        daysSinceLastOrder: daysBetween(last, t),
      },
      slipping: {
        customer: WHOLESALE_STORY.slipping,
        dropPct: Math.round((1 - recent / before) * 1000) / 10,
      },
      backorders: {
        product: WHOLESALE_STORY.backordered,
        unitsLast28Days: sold28(WHOLESALE_STORY.backordered).reduce((a, l) => a + l.backordered, 0),
      },
      stockout: {
        product: beans.name,
        daysOfCover: Math.round((beans.stockOnHand / beansRate) * 10) / 10,
      },
      costRise: {
        product: WHOLESALE_STORY.costRise,
        costBefore: dollars(cups.find((l) => daysBetween(l.ordered, t) > 42)!.unitCost),
        costAfter: dollars(cups.at(-1)!.unitCost),
      },
      deadStock: { products: [...WHOLESALE_STORY.deadStock] },
      overdue: {
        invoices: overdue.length,
        totalOwed: dollars(overdue.reduce((a, i) => a + invoiceNet(i), 0)),
        customers: [...new Set(overdue.map((i) => i.customer.name))].sort(),
      },
      totals: {
        // As the app's "last 30 days": today and the 29 days before.
        netSalesLast30Days: dollars(
          sim.invoices
            .filter((i) => within(i.date, t, 29, -1))
            .reduce((a, i) => a + invoiceNet(i), 0),
        ),
        moneyOwed: dollars(
          sim.invoices.filter((i) => !i.paidOn).reduce((a, i) => a + invoiceNet(i), 0),
        ),
        from: addDays(t, -29),
      },
    },
  };
}

/** Writes the wholesale demo files and `ground_truth.json` to `outDir`. */
export async function generateWholesaleDataset(options: {
  today: IsoDate;
  seed?: number;
  outDir: string;
}): Promise<WholesaleTruth> {
  const seed = options.seed ?? 42;
  mkdirSync(options.outDir, { recursive: true });
  const sim = simulateWholesale({ today: options.today, seed });
  const files = await writeWholesaleFiles(sim, options.outDir, seed);
  const truth = wholesaleTruth(sim, files, seed);
  writeFileSync(path.join(options.outDir, 'ground_truth.json'), JSON.stringify(truth, null, 2));
  return truth;
}
