import { getPack } from '@bizr/packs';
import { describe, expect, it } from 'vitest';

import { compileChangePlan } from '../change-plan/compile';
import { planFromPack } from '../change-plan/from-pack';
import { planChangeWithRules } from './plan-rules';

const pack = getPack('retail');
const catalog = compileChangePlan(
  't_abcdefghij',
  [],
  planFromPack(
    pack,
    pack.entities.map((e) => e.id),
  ),
).catalog;
const ops = (t: string) => {
  const d = planChangeWithRules(t, catalog);
  return d && 'plan' in d ? d.plan.ops : d;
};

describe('planChangeWithRules', () => {
  it('adds details, guessing the kind from the words', () => {
    expect(ops('I also want to track which salesperson made each sale')).toEqual([
      {
        op: 'add_field',
        entity: 'sale',
        field: {
          key: 'salesperson',
          label: 'Salesperson',
          type: 'text',
          required: false,
          pii: false,
        },
      },
    ]);
    expect(ops('Add a gift wrap (yes/no) to sales')).toMatchObject([
      {
        op: 'add_field',
        entity: 'sale',
        field: { key: 'gift_wrap', label: 'Gift wrap', type: 'boolean' },
      },
    ]);
    expect(ops('Track the delivery date for each sale')).toMatchObject([
      { field: { key: 'delivery_date', type: 'date' } },
    ]);
    expect(ops('Add a packing fee to supplier orders')).toMatchObject([
      { entity: 'purchase', field: { key: 'packing_fee', type: 'money' } },
    ]);
    expect(ops('Track which location packed each sale item')).toMatchObject([
      { entity: 'sale_line', field: { type: 'reference', references: 'location' } },
    ]);
  });

  it('renames record types and details', () => {
    expect(ops('Rename sales to orders')).toEqual([
      { op: 'rename_entity', entity: 'sale', label: { singular: 'Order', plural: 'Orders' } },
    ]);
    expect(ops('Rename selling price on products to RRP')).toEqual([
      { op: 'rename_field', entity: 'product', field: 'unit_price', label: 'RRP' },
    ]);
  });

  it('changes kinds and allowed values', () => {
    expect(ops('Make reorder point a whole number')).toEqual([
      { op: 'change_field_type', entity: 'product', field: 'reorder_point', type: 'integer' },
    ]);
    expect(ops('Add “on hold” as a status for sales')).toEqual([
      { op: 'add_allowed_values', entity: 'sale', field: 'status', values: ['on_hold'] },
    ]);
    expect(ops('Stop offering “ebay” as an option for sold through')).toEqual([
      { op: 'remove_allowed_values', entity: 'sale', field: 'channel', values: ['ebay'] },
    ]);
  });

  it('removes only when asked, and asks when a name fits several things', () => {
    expect(ops('Remove brand from products')).toEqual([
      { op: 'remove_field', entity: 'product', field: 'brand' },
    ]);
    expect(ops('Stop tracking expenses')).toEqual([{ op: 'remove_entity', entity: 'expense' }]);
    expect(ops('Unlink products from suppliers')).toEqual([
      { op: 'remove_relationship', entity: 'product', field: 'supplier' },
    ]);
    expect(planChangeWithRules('Remove the discount', catalog)).toMatchObject({
      clarify: expect.stringMatching(/on sales or on sale items/) as unknown,
    });
  });

  it('starts tracking new things', () => {
    expect(ops('Start tracking salespeople')).toMatchObject([
      {
        op: 'create_entity',
        key: 'salesperson',
        label: { singular: 'Salesperson', plural: 'Salespeople' },
      },
    ]);
    expect(planChangeWithRules('Start tracking products', catalog)).toEqual({
      clarify: 'You already track products.',
    });
  });

  it('leaves the rest to the AI', () => {
    expect(planChangeWithRules('What sold best last month?', catalog)).toBeNull();
    expect(planChangeWithRules('Remove the moon from products', catalog)).toBeNull();
  });
});
