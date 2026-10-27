import { addDays, daysBetween, type IsoDate } from '../dates';
import { Rng } from '../rng';

/**
 * Harbour & Pine Supply Co. (M14): a distributor of coffee, tea and café supplies selling on account
 * to cafés, delis, bakeries, a hotel and a salon. A year of invoices, payments, supplier orders and
 * stock, with stories planted relative to "today" so they always look current (WHOLESALE_STORY).
 */

export type Cents = number;

export const WHOLESALE_STORY = {
  /** Owes more than their credit limit after a run of big unpaid orders. */
  overCredit: 'Corner Bloom Café',
  /** Used to pay in about 18 days; lately about 45. */
  payingLater: 'Driftwood Deli',
  /** Orders every week, but not for the last 20 days. */
  missedReorder: 'Seaside Bakehouse',
  /** Spending well down over the last two months. */
  slipping: 'Hilltop Hotel',
  /** Out of stock for four weeks: orders sent short. */
  backordered: 'Oat Milk Barista 1L',
  /** About five days of stock left at the current rate. */
  stockout: 'Colombian Espresso Beans 1kg',
  /** The supplier's price went up 18% six weeks ago. */
  costRise: 'Paper Cups 12oz',
  /** In stock, not sold for four months or more. */
  deadStock: ['Chai Spice Syrup', 'Bamboo Stirrers'],
} as const;

export interface WProduct {
  code: string;
  name: string;
  category: string;
  caseSize: number;
  cost: Cents;
  price: Cents;
  supplier: string;
  /** How often cafés order it (relative). */
  popularity: number;
  stockOnHand: number;
}

export interface WSupplier {
  name: string;
  leadDays: number;
}

export interface WCustomer {
  account: string;
  name: string;
  type: string;
  city: string;
  rep: string;
  termsDays: number;
  creditLimit: Cents;
  /** Usual days between orders. */
  cycle: number;
  /** Usual days to pay. */
  payDays: number;
  /** Cases per order (mean). */
  size: number;
  email: string;
}

export interface WLine {
  product: WProduct;
  qty: number;
  backordered: number;
  unitPrice: Cents;
}

export interface WInvoice {
  number: string;
  date: IsoDate;
  customer: WCustomer;
  due: IsoDate;
  lines: WLine[];
  /** Null: not paid by today. */
  paidOn: IsoDate | null;
}

export interface WPayment {
  reference: string;
  date: IsoDate;
  invoice: WInvoice;
  amount: Cents;
  method: string;
}

export interface WPurchaseLine {
  po: string;
  supplier: string;
  ordered: IsoDate;
  received: IsoDate | null;
  product: WProduct;
  qty: number;
  unitCost: Cents;
}

export interface WholesaleSimulation {
  today: IsoDate;
  start: IsoDate;
  products: WProduct[];
  suppliers: WSupplier[];
  customers: WCustomer[];
  invoices: WInvoice[];
  payments: WPayment[];
  purchases: WPurchaseLine[];
  expenses: { month: IsoDate; category: string; amount: Cents }[];
}

const SUPPLIERS: WSupplier[] = [
  { name: 'Andes Coffee Importers', leadDays: 21 },
  { name: 'Leafline Teas', leadDays: 14 },
  { name: 'GreenPack Supplies', leadDays: 10 },
  { name: 'Dairy Alt Co.', leadDays: 7 },
  { name: 'Sweet Pour Syrups', leadDays: 14 },
];

const P = (
  code: string,
  name: string,
  category: string,
  caseSize: number,
  cost: number,
  price: number,
  supplier: string,
  popularity: number,
  stockOnHand = 0,
): WProduct => ({
  code,
  name,
  category,
  caseSize,
  cost: Math.round(cost * 100),
  price: Math.round(price * 100),
  supplier,
  popularity,
  stockOnHand,
});

function catalog(): WProduct[] {
  return [
    P(
      'CB-COL-1K',
      'Colombian Espresso Beans 1kg',
      'Coffee',
      6,
      84,
      126,
      'Andes Coffee Importers',
      10,
    ),
    P('CB-HOU-1K', 'House Blend Beans 1kg', 'Coffee', 6, 72, 108, 'Andes Coffee Importers', 9, 140),
    P('CB-DEC-1K', 'Decaf Beans 1kg', 'Coffee', 6, 78, 117, 'Andes Coffee Importers', 3, 60),
    P('TE-EB-100', 'English Breakfast Tea (100)', 'Tea', 10, 38, 62, 'Leafline Teas', 5, 90),
    P('TE-GR-100', 'Green Tea (100)', 'Tea', 10, 41, 66, 'Leafline Teas', 3, 70),
    P('TE-CH-1K', 'Chai Latte Powder 1kg', 'Tea', 6, 54, 86, 'Leafline Teas', 3, 48),
    P('MK-OAT-1L', 'Oat Milk Barista 1L', 'Milk', 12, 21, 33, 'Dairy Alt Co.', 9, 2),
    P('MK-ALM-1L', 'Almond Milk Barista 1L', 'Milk', 12, 23, 36, 'Dairy Alt Co.', 4, 55),
    P('CP-12-1000', 'Paper Cups 12oz', 'Packaging', 1000, 38, 64, 'GreenPack Supplies', 8, 85),
    P('CP-LID-1000', 'Cup Lids 12oz', 'Packaging', 1000, 22, 38, 'GreenPack Supplies', 7, 90),
    P('NP-2PLY-5K', 'Napkins 2-ply', 'Packaging', 5000, 31, 52, 'GreenPack Supplies', 4, 60),
    P('ST-BAM-5K', 'Bamboo Stirrers', 'Packaging', 5000, 18, 32, 'GreenPack Supplies', 0, 40),
    P('SY-VAN-1L', 'Vanilla Syrup 1L', 'Syrups', 6, 27, 45, 'Sweet Pour Syrups', 5, 75),
    P('SY-CAR-1L', 'Caramel Syrup 1L', 'Syrups', 6, 27, 45, 'Sweet Pour Syrups', 4, 66),
    P('SY-CHA-1L', 'Chai Spice Syrup', 'Syrups', 6, 29, 48, 'Sweet Pour Syrups', 0, 36),
  ];
}

const REPS = ['Dana Whitlock', 'Luis Ortega', 'Priya Nair'];
const CITIES = ['Portland', 'Bangor', 'Camden', 'Rockland', 'Bath', 'Belfast'];

function customers(rng: Rng): WCustomer[] {
  const named: [string, string, number, number, number][] = [
    // name, type, cycle days, pay days, cases per order
    [WHOLESALE_STORY.overCredit, 'Café', 7, 24, 9],
    [WHOLESALE_STORY.payingLater, 'Deli', 10, 18, 7],
    [WHOLESALE_STORY.missedReorder, 'Bakery', 7, 14, 6],
    [WHOLESALE_STORY.slipping, 'Hotel', 9, 25, 14],
    ['Brew & Bloom Salon', 'Salon', 21, 10, 3],
    ['Lighthouse Coffee Cart', 'Coffee cart', 8, 7, 4],
    ['Granite Street Café', 'Café', 6, 21, 8],
    ['Old Port Provisions', 'Deli', 12, 28, 6],
    ['Kettle & Crumb', 'Bakery', 9, 16, 5],
    ['Pinecone Coffee House', 'Café', 7, 20, 7],
    ['Harborview Inn', 'Hotel', 14, 30, 10],
    ['Mainely Muffins', 'Bakery', 11, 12, 4],
    ['The Daily Grind', 'Café', 5, 22, 8],
    ['Saltwater Deli', 'Deli', 13, 26, 5],
    ['Northwind Espresso', 'Coffee cart', 9, 9, 3],
    ['Fog & Foam', 'Café', 8, 19, 6],
  ];
  return named.map(([name, type, cycle, payDays, size], i) => {
    const termsDays = rng.pick([14, 30, 30, 30, 45]);
    return {
      account: `HP${String(1001 + i)}`,
      name,
      type,
      city: rng.pick(CITIES),
      rep: REPS[i % REPS.length]!,
      termsDays: name === WHOLESALE_STORY.payingLater ? 30 : termsDays,
      creditLimit:
        name === WHOLESALE_STORY.overCredit
          ? 500_000
          : Math.round(size * cycle * 0.6 + rng.int(10, 30)) * 10_000,
      cycle,
      payDays,
      size,
      email: `orders@${name.toLowerCase().replace(/[^a-z]+/g, '')}.example`,
    };
  });
}

export function simulateWholesale(options: { today: IsoDate; seed: number }): WholesaleSimulation {
  const rng = new Rng(options.seed);
  const today = options.today;
  const start = addDays(today, -365);
  const products = catalog();
  const byName = new Map(products.map((p) => [p.name, p]));
  const people = customers(rng);
  const invoices: WInvoice[] = [];
  let invoiceNo = 24_000;

  for (const c of people) {
    let day = addDays(start, rng.int(0, c.cycle - 1));
    while (day < today) {
      const ago = daysBetween(day, today);
      let size = c.size;
      if (c.name === WHOLESALE_STORY.missedReorder && ago <= 20) break;
      if (c.name === WHOLESALE_STORY.slipping && ago <= 60)
        size = Math.max(1, Math.round(c.size * 0.3));
      if (c.name === WHOLESALE_STORY.overCredit && ago <= 45) size = c.size * 2;
      // Products nobody orders (the dead stock) are never picked.
      const picks = new Set<WProduct>();
      const n = rng.int(2, 5);
      while (picks.size < n) picks.add(rng.weighted(products, (p) => p.popularity));
      const lines: WLine[] = [];
      for (const p of picks) {
        const qty = Math.max(1, Math.round((size / n) * (0.6 + rng.next() * 0.8)));
        // Out of stock for the last four weeks: sent short, the rest still to send.
        const short = p.name === WHOLESALE_STORY.backordered && ago <= 28;
        const sent = short ? Math.floor(qty / 3) : qty;
        lines.push({ product: p, qty: sent, backordered: qty - sent, unitPrice: p.price });
      }
      if (lines.length) {
        invoiceNo += 1;
        const pay =
          c.name === WHOLESALE_STORY.payingLater && ago <= 135
            ? 45 + rng.int(-4, 4)
            : c.name === WHOLESALE_STORY.overCredit && ago <= 60
              ? 999
              : Math.max(1, c.payDays + rng.int(-5, 6));
        const paidOn = addDays(day, pay);
        invoices.push({
          number: `INV-${invoiceNo}`,
          date: day,
          customer: c,
          due: addDays(day, c.termsDays),
          lines,
          paidOn: paidOn < today ? paidOn : null,
        });
      }
      day = addDays(day, Math.max(2, c.cycle + rng.int(-2, 2)));
    }
  }
  invoices.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.number < b.number ? -1 : 1,
  );

  const payments: WPayment[] = invoices
    .filter((i) => i.paidOn)
    .map((inv, k) => ({
      reference: `PMT-${String(5000 + k)}`,
      date: inv.paidOn!,
      invoice: inv,
      amount: invoiceNet(inv),
      method: rng.pick(['ACH', 'ACH', 'Check', 'Card']),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // Stock: the story product has about five days left at the last four weeks' rate.
  const rate = (p: WProduct) =>
    invoices
      .filter((i) => daysBetween(i.date, today) <= 28)
      .flatMap((i) => i.lines)
      .filter((l) => l.product === p)
      .reduce((a, l) => a + l.qty, 0) / 28;
  const beans = byName.get(WHOLESALE_STORY.stockout)!;
  beans.stockOnHand = Math.max(1, Math.round(rate(beans) * 5));

  // Supplier orders every three weeks; the cups' cost rises 18% six weeks ago.
  const purchases: WPurchaseLine[] = [];
  let po = 7100;
  for (let d = start; d < today; d = addDays(d, 21)) {
    for (const s of SUPPLIERS) {
      po += 1;
      for (const p of products.filter((x) => x.supplier === s.name && x.popularity > 0)) {
        const rise = p.name === WHOLESALE_STORY.costRise && daysBetween(d, today) <= 42;
        const received = addDays(d, s.leadDays);
        purchases.push({
          po: `PO-${po}`,
          supplier: s.name,
          ordered: d,
          received: received < today ? received : null,
          product: p,
          qty: rng.int(10, 40),
          unitCost: rise ? Math.round(p.cost * 1.18) : p.cost,
        });
      }
    }
  }
  const cups = byName.get(WHOLESALE_STORY.costRise)!;
  cups.cost = Math.round(cups.cost * 1.18);

  const expenses: WholesaleSimulation['expenses'] = [];
  for (let m = 0; m < 12; m++) {
    const first = new Date(`${start.slice(0, 8)}01T00:00:00Z`);
    first.setUTCMonth(first.getUTCMonth() + m + 1);
    const month = first.toISOString().slice(0, 10);
    if (month >= today) break;
    for (const [category, amount] of [
      ['Warehouse rent', 3_200_00],
      ['Van fuel', 640_00 + rng.int(-80, 80) * 100],
      ['Wages', 9_800_00],
      ['Insurance', 410_00],
    ] as const)
      expenses.push({ month, category, amount });
  }

  return {
    today,
    start,
    products,
    suppliers: SUPPLIERS,
    customers: people,
    invoices,
    payments,
    purchases,
    expenses,
  };
}

export function invoiceNet(inv: WInvoice): Cents {
  return inv.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
}
