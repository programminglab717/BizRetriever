import type { FieldType } from '@bizr/packs';

import { ident } from '../sql/ident';
import { SQL_TYPES } from './names';

/**
 * Changing what kind of detail a column holds (`change_field_type`). Every conversion is written so
 * it never fails half way: a value that can't be read in the new kind becomes blank, and the impact
 * check counts those first. `pg_input_is_valid` (Postgres 16+) decides what can be read.
 */

export type ValueType = Exclude<FieldType, 'reference'>;

const NUMERIC = new Set<ValueType>(['integer', 'decimal', 'money', 'percent']);

/** Conversions that keep every value exactly (so undoing them is a plain change back). */
const LOSSLESS: ReadonlySet<string> = new Set([
  'integer>decimal',
  'integer>money',
  'decimal>money',
  'money>decimal',
  'date>datetime',
  'boolean>integer',
  ...(['integer', 'decimal', 'money', 'percent', 'date', 'datetime', 'boolean'] as const).map(
    (t) => `${t}>text`,
  ),
]);

export interface Conversion {
  /** `USING` expression for `ALTER COLUMN … TYPE`. */
  using: string;
  /** True when no value can change or be lost. */
  lossless: boolean;
  /** SQL condition: this row's value would be blanked or changed (for the impact check). */
  changes: string;
}

/** How to turn `col` from one kind into another; `null` when it makes no sense (date → yes/no). */
export function conversion(col: string, from: ValueType, to: ValueType): Conversion | null {
  if (from === to) return null;
  const c = ident(col);
  const target = SQL_TYPES[to]!;
  const lossless = LOSSLESS.has(`${from}>${to}`);
  const readable = (expr: string) =>
    `CASE WHEN pg_input_is_valid(${expr}, '${target}') THEN (${expr})::${target} END`;

  if (to === 'text') return { using: `${c}::text`, lossless: true, changes: 'false' };
  if (from === 'text') {
    const v =
      to === 'boolean' || to === 'date' || to === 'datetime'
        ? `btrim(${c})`
        : `replace(btrim(${c}), ',', '')`;
    const using = readable(v);
    return {
      using,
      lossless: false,
      changes: `${c} IS NOT NULL AND btrim(${c}) <> '' AND (${using}) IS NULL`,
    };
  }
  if (NUMERIC.has(from) && NUMERIC.has(to)) {
    if (lossless) return { using: `${c}::${target}`, lossless, changes: 'false' };
    const using = to === 'integer' ? `round(${c})::bigint` : readable(`${c}::text`);
    return {
      using,
      lossless,
      changes: `${c} IS NOT NULL AND ((${using}) IS NULL OR (${using})::numeric <> ${c}::numeric)`,
    };
  }
  if (from === 'date' && to === 'datetime')
    return { using: `${c}::timestamptz`, lossless, changes: 'false' };
  if (from === 'datetime' && to === 'date')
    return { using: `${c}::date`, lossless, changes: `${c} IS NOT NULL AND ${c}::time <> '00:00'` };
  if (from === 'boolean' && NUMERIC.has(to))
    return {
      using: `CASE WHEN ${c} THEN 1 WHEN NOT ${c} THEN 0 END::${target}`,
      lossless,
      changes: 'false',
    };
  if (NUMERIC.has(from) && to === 'boolean')
    return {
      using: `(${c} <> 0)`,
      lossless,
      changes: `${c} IS NOT NULL AND ${c} NOT IN (0, 1)`,
    };
  return null;
}
