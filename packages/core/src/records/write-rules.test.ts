import { getPack } from '@bizr/packs';
import { describe, expect, it } from 'vitest';

import { compileChangePlan } from '../change-plan/compile';
import { planFromPack } from '../change-plan/from-pack';
import { draftWithRules, takeDate } from './write-rules';

const pack = getPack('retail');
const catalog = compileChangePlan(
  't_abcdefghij',
  [],
  planFromPack(
    pack,
    pack.entities.map((e) => e.id),
  ),
).catalog;
const draft = (t: string) => draftWithRules(t, catalog, { today: '2026-10-13' });

describe('takeDate', () => {
  it('reads the usual ways of saying a day', () => {
    expect(takeDate('sold today', '2026-10-13').date).toBe('2026-10-13');
    expect(takeDate('yesterday', '2026-10-13').date).toBe('2026-10-12');
    expect(takeDate('on 3 Oct', '2026-10-13').date).toBe('2026-10-03');
    expect(takeDate('on October 3rd, 2025', '2026-10-13').date).toBe('2025-10-03');
    expect(takeDate('on Dec 24', '2026-10-13').date).toBe('2025-12-24'); // not in the future
    expect(takeDate('on 2026-09-30', '2026-10-13').date).toBe('2026-09-30');
  });
});

describe('draftWithRules', () => {
  it('reads a sale with items, a customer, a date and a channel', () => {
    expect(draft('Add a sale: 5 Sage mugs to Bloom & Co today')).toEqual({
      operation: 'insert',
      entity: 'sale',
      values: { sale_date: '2026-10-13' },
      mentions: { customer: 'Bloom & Co' },
      lines: [
        { entity: 'sale_line', values: { quantity: '5' }, mentions: { product: 'Sage mugs' } },
      ],
    });
    expect(
      draft('I sold 2 Amber Bud Vase and 1 Birthday Card Cake on Etsy yesterday'),
    ).toMatchObject({
      values: { sale_date: '2026-10-12', channel: 'etsy' },
      lines: [
        { values: { quantity: '2' }, mentions: { product: 'Amber Bud Vase' } },
        { values: { quantity: '1' }, mentions: { product: 'Birthday Card Cake' } },
      ],
    });
    expect(draft('record a sale of 3 x linen tea towel at $12 each in the shop')).toMatchObject({
      values: { channel: 'in_store' },
      lines: [
        { values: { quantity: '3', unit_price: '12' }, mentions: { product: 'linen tea towel' } },
      ],
    });
  });

  it('reads changes to one detail of a record', () => {
    expect(draft('Change the price of Sage Stoneware Mug to $20')).toEqual({
      operation: 'update',
      entity: 'product',
      target: 'Sage Stoneware Mug',
      values: { unit_price: '20' },
      mentions: {},
    });
    expect(draft("Set Bloom & Co's city to Portland")).toMatchObject({
      entity: 'customer',
      target: 'Bloom & Co',
      values: { city: 'Portland' },
    });
    expect(draft('Mark order 1043 as refunded')).toMatchObject({
      entity: 'sale',
      target: '1043',
      values: { status: 'refunded' },
    });
    expect(draft('Order #1043 was paid')).toMatchObject({
      entity: 'sale',
      target: '1043',
      values: { payment_status: 'paid' },
    });
    expect(draft('Change the supplier of Sage Stoneware Mug to Wick & Wax Co')).toMatchObject({
      entity: 'product',
      mentions: { supplier: 'Wick & Wax Co' },
    });
  });

  it('reads new products, customers and expenses', () => {
    expect(draft('Add a product: Linen Napkin, price $12, cost $4, category Linens')).toEqual({
      operation: 'insert',
      entity: 'product',
      values: { name: 'Linen Napkin', unit_price: '12', unit_cost: '4', category: 'Linens' },
      mentions: {},
      lines: [],
    });
    expect(draft('New customer called Juniper Goods in Austin')).toMatchObject({
      entity: 'customer',
      values: { name: 'Juniper Goods', city: 'Austin' },
    });
    expect(draft('Add an expense: $45 for postage today')).toMatchObject({
      entity: 'expense',
      values: { amount: '45', description: 'postage', expense_date: '2026-10-13' },
    });
  });

  it('leaves what it can’t read to the AI', () => {
    expect(draft('How are sales this month?')).toBeNull();
    expect(draft('Add a product: Linen Napkin, made by hand in small batches')).toBeNull();
    expect(draft('Add a spaceship called X')).toBeNull();
  });
});
