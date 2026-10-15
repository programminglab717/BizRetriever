import type { Rng } from './rng';

/** Money is kept in integer cents throughout the generator to avoid float drift. */
export type Cents = number;

export interface Supplier {
  name: string;
  leadTimeDays: number;
}

export interface Product {
  sku: string;
  /** Whether the stock list shows the SKU (some are blank on purpose). */
  skuListed: boolean;
  name: string;
  category: string;
  price: Cents;
  cost: Cents;
  supplier: string;
  /** Relative popularity for sampling. */
  weight: number;
  /** Sells only around Christmas (Nov–early Jan). */
  seasonal: boolean;
  /** Seasonal items that stopped selling after the holidays (dead stock story). */
  deadAfterHolidays: boolean;
  discontinued: boolean;
  reorderAt: number;
}

export const SUPPLIERS: Supplier[] = [
  { name: 'Hearth & Kiln Ceramics', leadTimeDays: 14 },
  { name: 'Wick & Wax Co', leadTimeDays: 10 },
  { name: 'Northfield Linen', leadTimeDays: 21 },
  { name: 'Clearwater Glassworks', leadTimeDays: 18 },
  { name: 'Paper Fern Studio', leadTimeDays: 7 },
];

interface ProductSeed {
  name: string;
  price: number;
  weight: number;
  seasonal?: boolean;
  dead?: boolean;
  discontinued?: boolean;
}

interface CategorySeed {
  category: string;
  code: string;
  supplier: string;
  costRatio: number;
  items: ProductSeed[];
}

const colours = (base: string, list: string[], price: number, weight: number): ProductSeed[] =>
  list.map((c) => ({ name: `${c} ${base}`, price, weight }));

const CATEGORIES: CategorySeed[] = [
  {
    category: 'Mugs & Cups',
    code: 'MUG',
    supplier: 'Hearth & Kiln Ceramics',
    costRatio: 0.4,
    items: [
      { name: 'Sage Stoneware Mug', price: 18, weight: 14 },
      ...colours('Stoneware Mug', ['Oat', 'Charcoal', 'Blush', 'Ocean'], 18, 3),
      ...colours('Espresso Cup', ['Terracotta', 'Cream', 'Black'], 12, 1.5),
      ...colours('Latte Bowl', ['Sage', 'Oat'], 22, 1.2),
      { name: 'Speckled Café Mug', price: 16, weight: 2 },
      { name: 'Enamel Camp Mug', price: 14, weight: 1.2 },
    ],
  },
  {
    category: 'Candles',
    code: 'CDL',
    supplier: 'Wick & Wax Co',
    costRatio: 0.32,
    items: [
      ...['Fig & Cedar', 'Sea Salt', 'Lavender Fields', 'Amber Wood', 'Orange Blossom'].flatMap(
        (scent) => [
          { name: `${scent} Candle Small`, price: 16, weight: 2.2 },
          { name: `${scent} Candle Large`, price: 28, weight: 1.6 },
        ],
      ),
      { name: 'Christmas Spice Candle', price: 26, weight: 4, seasonal: true, dead: true },
      { name: 'Winter Pine Candle', price: 26, weight: 2.5, seasonal: true, dead: true },
      { name: 'Cinnamon Ember Candle', price: 24, weight: 2, seasonal: true, dead: true },
    ],
  },
  {
    category: 'Linens',
    code: 'LIN',
    supplier: 'Northfield Linen',
    costRatio: 0.42,
    items: [
      { name: 'Linen Napkin Set', price: 20, weight: 4 },
      ...colours('Linen Tea Towel', ['Natural', 'Rust', 'Sage'], 14, 2),
      ...colours('Linen Table Runner', ['Natural', 'Charcoal'], 38, 0.8),
      ...colours('Linen Apron', ['Natural', 'Rust'], 34, 0.9),
      { name: 'Waffle Hand Towel', price: 18, weight: 1.4 },
      { name: 'Linen Cushion Cover', price: 32, weight: 1, discontinued: true },
    ],
  },
  {
    category: 'Glassware',
    code: 'GLS',
    supplier: 'Clearwater Glassworks',
    costRatio: 0.38,
    items: [
      { name: 'Glass Carafe', price: 34, weight: 3 },
      { name: 'Ribbed Tumbler Set of 2', price: 22, weight: 2 },
      { name: 'Ribbed Tumbler Set of 4', price: 38, weight: 1.2 },
      { name: 'Wine Glass Pair', price: 36, weight: 1.3 },
      ...colours('Bud Vase', ['Amber', 'Clear', 'Green'], 15, 1.6),
      ...['Small', 'Medium', 'Large'].map((s) => ({
        name: `Glass Storage Jar ${s}`,
        price: 10 + 4 * ['Small', 'Medium', 'Large'].indexOf(s),
        weight: 1.1,
      })),
    ],
  },
  {
    category: 'Prints',
    code: 'PRT',
    supplier: 'Paper Fern Studio',
    costRatio: 0.25,
    items: [
      ...['Fern', 'Olive', 'Lemon', 'Poppy'].flatMap((p) => [
        { name: `Botanical Print ${p} A4`, price: 18, weight: 1.1 },
        { name: `Botanical Print ${p} A3`, price: 28, weight: 0.8 },
      ]),
      ...['Portland', 'Austin', 'Boston'].map((c) => ({
        name: `${c} Map Print A3`,
        price: 30,
        weight: 0.7,
      })),
    ],
  },
  {
    category: 'Plants & Pots',
    code: 'POT',
    supplier: 'Hearth & Kiln Ceramics',
    costRatio: 0.42,
    items: [
      { name: 'Terracotta Herb Pot', price: 12, weight: 2 },
      ...['Small', 'Medium', 'Large'].map((s, i) => ({
        name: `Terracotta Pot ${s}`,
        price: 9 + i * 6,
        weight: 1.3,
      })),
      ...colours('Hanging Planter', ['White', 'Black'], 24, 0.9),
      ...colours('Ceramic Plant Pot', ['Sage', 'Oat', 'Speckled'], 26, 1.1),
    ],
  },
  {
    category: 'Cards',
    code: 'CRD',
    supplier: 'Paper Fern Studio',
    costRatio: 0.3,
    items: [
      ...['Floral', 'Cake', 'Balloons'].map((d) => ({
        name: `Birthday Card ${d}`,
        price: 5,
        weight: 2.2,
      })),
      ...['Floral', 'Simple'].map((d) => ({ name: `Thank You Card ${d}`, price: 5, weight: 1.4 })),
      { name: 'Wedding Card', price: 6, weight: 0.9 },
      { name: 'New Baby Card', price: 5, weight: 0.9 },
      { name: 'Sympathy Card', price: 5, weight: 0.7 },
      ...['Hare', 'Wren', 'Oak'].map((d) => ({
        name: `Lino Print Card ${d}`,
        price: 5,
        weight: 1,
      })),
    ],
  },
  {
    category: 'Kitchen',
    code: 'KIT',
    supplier: 'Hearth & Kiln Ceramics',
    costRatio: 0.45,
    items: [
      { name: 'Olive Wood Board Small', price: 24, weight: 1.3 },
      { name: 'Olive Wood Board Large', price: 42, weight: 0.9 },
      { name: 'Marble Serving Board', price: 46, weight: 0.8 },
      { name: 'Wooden Spoon Set', price: 18, weight: 1.4 },
      { name: 'Ceramic Butter Dish', price: 22, weight: 1 },
      ...colours('Salt Pig', ['Sage', 'Oat'], 20, 0.9),
      { name: 'Loose Leaf Tea Tin', price: 12, weight: 1.2 },
    ],
  },
  {
    category: 'Home Fragrance',
    code: 'FRG',
    supplier: 'Wick & Wax Co',
    costRatio: 0.33,
    items: ['Fig & Cedar', 'Sea Salt', 'Lavender Fields'].flatMap((scent) => [
      { name: `${scent} Reed Diffuser`, price: 32, weight: 1.2 },
      { name: `${scent} Room Spray`, price: 18, weight: 1.1 },
    ]),
  },
  {
    category: 'Seasonal',
    code: 'SEA',
    supplier: 'Paper Fern Studio',
    costRatio: 0.35,
    items: [
      { name: 'Christmas Bauble Set', price: 28, weight: 3, seasonal: true, dead: true },
      { name: 'Wreath Making Kit', price: 45, weight: 1.5, seasonal: true, dead: true },
      { name: 'Christmas Card Pack', price: 12, weight: 3, seasonal: true },
      { name: 'Gingerbread Cutter Set', price: 14, weight: 1.5, seasonal: true },
      { name: 'Advent Candle', price: 22, weight: 1.5, seasonal: true },
    ],
  },
];

const cents = (dollars: number): Cents => Math.round(dollars * 100);

export function buildProducts(rng: Rng): Product[] {
  const products: Product[] = [];
  for (const cat of CATEGORIES) {
    cat.items.forEach((item, i) => {
      const price = cents(item.price);
      // Round cost to 5 cents so the stock list looks hand-typed.
      const cost = Math.round((price * cat.costRatio * (0.92 + rng.next() * 0.16)) / 5) * 5;
      products.push({
        sku: `FW-${cat.code}-${String(i + 1).padStart(3, '0')}`,
        skuListed: rng.next() > 0.08,
        name: item.name,
        category: cat.category,
        price,
        cost,
        supplier: cat.supplier,
        weight: item.weight,
        seasonal: item.seasonal ?? false,
        deadAfterHolidays: item.dead ?? false,
        discontinued: item.discontinued ?? false,
        reorderAt: rng.int(5, 20),
      });
    });
  }
  for (const p of products) {
    // Story products always keep their SKU so the story is easy to follow in the demo.
    if (STORY_PRODUCTS.includes(p.name)) p.skuListed = true;
    // The owner never updated the napkin cost on the stock list after the supplier's June rise.
    if (p.name === STORY.marginSqueeze) {
      p.price = NAPKIN_PRICE;
      p.cost = NAPKIN_COST_BEFORE;
    }
  }
  return products;
}

export const STORY = {
  stockout: 'Sage Stoneware Mug',
  deadStock: 'Christmas Spice Candle',
  marginSqueeze: 'Linen Napkin Set',
  returnSpike: 'Glass Carafe',
  risingStar: 'Terracotta Herb Pot',
  slippingStockist: 'Bloom & Co',
} as const;

const STORY_PRODUCTS: string[] = [
  STORY.stockout,
  STORY.deadStock,
  STORY.marginSqueeze,
  STORY.returnSpike,
  STORY.risingStar,
];

/** The napkin set's supplier cost before and after the June price rise (+22%). */
export const NAPKIN_COST_BEFORE: Cents = 840;
export const NAPKIN_COST_AFTER: Cents = 1025;
export const NAPKIN_PRICE: Cents = 2000;

export interface Customer {
  id: number;
  name: string;
  email: string | null;
  city: string;
  region: string;
  /** Online shoppers come back at different rates. */
  loyalty: number;
}

const FIRST = [
  'Olivia',
  'Liam',
  'Emma',
  'Noah',
  'Ava',
  'Elijah',
  'Sophia',
  'James',
  'Isabella',
  'Lucas',
  'Mia',
  'Mason',
  'Amelia',
  'Ethan',
  'Harper',
  'Logan',
  'Evelyn',
  'Aiden',
  'Abigail',
  'Jacob',
  'Emily',
  'Daniel',
  'Ella',
  'Henry',
  'Grace',
  'Jack',
  'Chloe',
  'Owen',
  'Nora',
  'Leo',
  'Zoe',
  'Samuel',
  'Lily',
  'Wyatt',
  'Hannah',
  'Julian',
  'Aria',
  'Gabriel',
  'Layla',
  'Isaac',
  'Riley',
  'Priya',
  'Arjun',
  'Mei',
  'Hiro',
  'Fatima',
  'Omar',
  'Sofia',
  'Mateo',
  'Chen',
  'Aisha',
];
const LAST = [
  'Smith',
  'Johnson',
  'Williams',
  'Brown',
  'Jones',
  'Garcia',
  'Miller',
  'Davis',
  'Rodriguez',
  'Martinez',
  'Hernandez',
  'Lopez',
  'Wilson',
  'Anderson',
  'Thomas',
  'Taylor',
  'Moore',
  'Jackson',
  'Martin',
  'Lee',
  'Thompson',
  'White',
  'Harris',
  'Clark',
  'Lewis',
  'Robinson',
  'Walker',
  'Young',
  'Allen',
  'King',
  'Wright',
  'Scott',
  'Green',
  'Baker',
  'Adams',
  'Nelson',
  'Hill',
  'Campbell',
  'Patel',
  'Nguyen',
  'Kim',
  'Khan',
  'Rossi',
  'Okafor',
  'Silva',
  'Cohen',
  'Murphy',
  'Fischer',
];
const CITIES: [string, string][] = [
  ['Portland', 'OR'],
  ['Seattle', 'WA'],
  ['Austin', 'TX'],
  ['Denver', 'CO'],
  ['Boston', 'MA'],
  ['Chicago', 'IL'],
  ['Brooklyn', 'NY'],
  ['San Diego', 'CA'],
  ['Minneapolis', 'MN'],
  ['Asheville', 'NC'],
  ['Burlington', 'VT'],
  ['Savannah', 'GA'],
  ['Madison', 'WI'],
  ['Sacramento', 'CA'],
  ['Richmond', 'VA'],
];

export function buildOnlineCustomers(rng: Rng, count: number): Customer[] {
  const seen = new Set<string>();
  const customers: Customer[] = [];
  while (customers.length < count) {
    const first = rng.pick(FIRST);
    const last = rng.pick(LAST);
    const name = `${first} ${last}`;
    if (seen.has(name)) continue;
    seen.add(name);
    const [city, region] = rng.pick(CITIES);
    const handle = `${first}.${last}`.toLowerCase();
    const domain = rng.pick(['gmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'proton.me']);
    customers.push({
      id: customers.length + 1,
      name,
      email: `${handle}${rng.chance(0.3) ? rng.int(1, 99) : ''}@${domain}`,
      city,
      region,
      loyalty: rng.next() ** 2,
    });
  }
  return customers;
}

export interface Stockist {
  name: string;
  /** How the name is spelled on different invoices (near-duplicate story). */
  spellings: string[];
  city: string;
  region: string;
  monthlyOrderCents: Cents;
}

export const STOCKISTS: Stockist[] = [
  {
    name: 'Bloom & Co',
    spellings: ['Bloom & Co', 'Bloom and Co.', 'BLOOM & CO LTD'],
    city: 'Portland',
    region: 'OR',
    monthlyOrderCents: 90_000,
  },
  {
    name: 'The Little Pantry',
    spellings: ['The Little Pantry'],
    city: 'Seattle',
    region: 'WA',
    monthlyOrderCents: 52_000,
  },
  {
    name: 'Juniper House',
    spellings: ['Juniper House', 'Juniper House Inc'],
    city: 'Boise',
    region: 'ID',
    monthlyOrderCents: 61_000,
  },
  {
    name: 'Willow Lane Gifts',
    spellings: ['Willow Lane Gifts'],
    city: 'Eugene',
    region: 'OR',
    monthlyOrderCents: 44_000,
  },
  {
    name: 'Harbor Home',
    spellings: ['Harbor Home'],
    city: 'Tacoma',
    region: 'WA',
    monthlyOrderCents: 38_000,
  },
  {
    name: 'Copper Kettle Market',
    spellings: ['Copper Kettle Market'],
    city: 'Bend',
    region: 'OR',
    monthlyOrderCents: 47_000,
  },
  {
    name: 'Maple & Moss',
    spellings: ['Maple & Moss', 'Maple and Moss'],
    city: 'Spokane',
    region: 'WA',
    monthlyOrderCents: 35_000,
  },
  {
    name: 'North Star Mercantile',
    spellings: ['North Star Mercantile'],
    city: 'Missoula',
    region: 'MT',
    monthlyOrderCents: 41_000,
  },
];

/** Stockists with invoices more than 30 days overdue (overdue payments story). */
export const OVERDUE_STOCKISTS = ['Harbor Home', 'North Star Mercantile'];
