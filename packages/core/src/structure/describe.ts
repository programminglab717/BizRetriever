import type { CatalogEntity } from '../change-plan/compile';
import type { ChangeOp, FieldDef } from '../change-plan/schema';

/**
 * Structural changes in the owner's words (PRODUCT_SPEC Journey 6, copy guidelines): no "table",
 * "column" or "schema". Pure; used by change cards and the change history.
 */

const KIND: Record<FieldDef['type'], string> = {
  text: 'text',
  integer: 'a whole number',
  decimal: 'a number',
  money: 'an amount of money',
  percent: 'a percentage',
  date: 'a date',
  datetime: 'a date and time',
  boolean: 'yes or no',
  reference: 'a link',
};

export const kindName = (t: FieldDef['type']) => KIND[t];

const list = (values: readonly string[]) =>
  values.length <= 1
    ? (values[0] ?? '')
    : `${values.slice(0, -1).join(', ')} and ${values.at(-1)!}`;
const words = (v: string) => v.replace(/_/g, ' ');

export function describeOp(op: ChangeOp, catalog: readonly CatalogEntity[]): string {
  const entity = (key: string) => catalog.find((e) => e.key === key);
  const plural = (key: string) => (entity(key)?.label.plural ?? words(key)).toLowerCase();
  const fieldLabel = (e: string, f: string) =>
    entity(e)?.fields.find((x) => x.key === f)?.label ?? words(f);
  switch (op.op) {
    case 'create_entity':
      return `Start keeping track of ${op.label.plural.toLowerCase()}`;
    case 'add_field':
      return op.field.type === 'reference'
        ? `Link ${plural(op.entity)} to ${plural(op.field.references ?? '')} (“${op.field.label}”)`
        : `Add “${op.field.label}” to ${plural(op.entity)}, as ${kindName(op.field.type)}`;
    case 'remove_field':
      return `Remove “${fieldLabel(op.entity, op.field)}” from ${plural(op.entity)}`;
    case 'remove_entity':
      return `Stop keeping track of ${plural(op.entity)}, and remove them`;
    case 'create_index':
      return `Make finding ${plural(op.entity)} by ${list(op.fields.map((f) => `“${fieldLabel(op.entity, f)}”`))} faster`;
    case 'rename_entity':
      return `Call ${plural(op.entity)} “${op.label.plural}”`;
    case 'rename_field':
      return `Rename “${fieldLabel(op.entity, op.field)}” on ${plural(op.entity)} to “${op.label}”`;
    case 'change_field_type':
      return `Make “${fieldLabel(op.entity, op.field)}” on ${plural(op.entity)} ${kindName(op.type)}`;
    case 'add_allowed_values':
      return `Allow ${list(op.values.map((v) => `“${words(v)}”`))} for “${fieldLabel(op.entity, op.field)}” on ${plural(op.entity)}`;
    case 'remove_allowed_values':
      return `Stop offering ${list(op.values.map((v) => `“${words(v)}”`))} for “${fieldLabel(op.entity, op.field)}” on ${plural(op.entity)}`;
    case 'remove_relationship': {
      const target = entity(op.entity)?.fields.find((f) => f.key === op.field)?.references;
      return `Unlink ${plural(op.entity)} from ${target ? plural(target) : '…'} (their names are kept as text)`;
    }
  }
}

/** Each op described against the catalog as it is when that op runs. */
export function describePlan(
  ops: readonly ChangeOp[],
  before: readonly CatalogEntity[],
  step: (catalog: CatalogEntity[], op: ChangeOp) => CatalogEntity[],
): string[] {
  let catalog = [...before];
  return ops.map((op) => {
    const text = describeOp(op, catalog);
    try {
      catalog = step(catalog, op);
    } catch {
      // described against the last good catalog
    }
    return text;
  });
}
