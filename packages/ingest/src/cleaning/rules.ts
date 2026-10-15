import { z } from 'zod';

/**
 * The cleaning-rule vocabulary (AI_DESIGN §3.3). The AI may only choose from these deterministic,
 * tested transforms; anything else fails validation. Column references are 0-based column indexes in
 * the source sheet. Virtual columns produced by row rules are referenced by name.
 */

export const virtualColumns = ['section', 'sheet_name', 'unpivot_key', 'unpivot_value'] as const;
export type VirtualColumn = (typeof virtualColumns)[number];

export const columnRefSchema = z.union([z.number().int().min(0).max(199), z.enum(virtualColumns)]);
export type ColumnRef = z.infer<typeof columnRefSchema>;

// --- Row rules ---------------------------------------------------------------------------------

export const rowRuleSchema = z.discriminatedUnion('rule', [
  z
    .object({
      rule: z.literal('skip_rows'),
      /** Skip rows the region detector classified as one of these kinds (data rows are never skipped this way). */
      kinds: z.array(z.enum(['totals', 'blank', 'note', 'section', 'header', 'title'])).optional(),
      /** Or rows where a column's text matches (case-insensitive). */
      where: z
        .object({
          column: columnRefSchema,
          equals: z.array(z.string().max(80)).max(50).optional(),
          startsWith: z.array(z.string().max(80)).max(50).optional(),
          isEmpty: z.boolean().optional(),
        })
        .strict()
        .optional(),
      /** Or specific sheet rows (1-based, as the user sees them in Excel). */
      rows: z.array(z.number().int().min(1)).max(1000).optional(),
      reason: z.string().max(120),
    })
    .strict(),
  z
    .object({
      rule: z.literal('fill_down'),
      columns: z.array(columnRefSchema).min(1).max(50),
      /** Only fill within rows that share this column's value (e.g. the order number). */
      withinGroup: columnRefSchema.optional(),
    })
    .strict(),
  z
    .object({
      rule: z.literal('unpivot'),
      /** Columns whose headers become values (e.g. Jan…Dec). */
      columns: z.array(z.number().int().min(0)).min(2).max(60),
    })
    .strict(),
]);
export type RowRule = z.infer<typeof rowRuleSchema>;

// --- Value rules -------------------------------------------------------------------------------

export const valueRuleSchema = z.discriminatedUnion('rule', [
  z.object({ rule: z.literal('trim') }).strict(),
  z.object({ rule: z.literal('collapse_whitespace') }).strict(),
  z.object({ rule: z.literal('case'), to: z.enum(['upper', 'lower', 'title']) }).strict(),
  z
    .object({
      rule: z.literal('null_if'),
      values: z.array(z.string().max(40)).max(50),
    })
    .strict(),
  z
    .object({
      rule: z.literal('parse_number'),
      decimalSeparator: z.enum(['.', ',']).optional(),
      /** How to read "15%": as 15 (number) or 0.15 (fraction). Default fraction. */
      percent: z.enum(['number', 'fraction']).optional(),
    })
    .strict(),
  z
    .object({
      rule: z.literal('parse_date'),
      order: z.enum(['DMY', 'MDY', 'YMD']).optional(),
      allowSerial: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      rule: z.literal('parse_boolean'),
      trueValues: z.array(z.string().max(20)).max(20).optional(),
      falseValues: z.array(z.string().max(20)).max(20).optional(),
    })
    .strict(),
  z
    .object({
      rule: z.literal('strip_unit'),
      units: z.array(z.string().max(20)).min(1).max(20),
      /** Multiply by this after stripping (e.g. "boxes" of 12 → 12). Default 1. */
      factor: z.number().positive().max(10_000).optional(),
    })
    .strict(),
  z
    .object({
      rule: z.literal('map_values'),
      map: z.record(z.string().max(80), z.string().max(80)),
      /** What to do with values not in the map. Default keep. */
      otherwise: z.enum(['keep', 'null', 'error']).optional(),
    })
    .strict(),
  z
    .object({
      rule: z.literal('split_column'),
      delimiter: z.string().min(1).max(5),
      part: z.number().int().min(0).max(20),
    })
    .strict(),
  z.object({ rule: z.literal('negate') }).strict(),
]);
export type ValueRule = z.infer<typeof valueRuleSchema>;

// --- Derived values ----------------------------------------------------------------------------

/** Tiny arithmetic language over other fields of the same record (e.g. qty × price − discount). */
export type Expr =
  | { field: string }
  | { const: number }
  | { op: 'add' | 'sub' | 'mul' | 'div'; args: Expr[] }
  | { coalesce: Expr[] };

export const exprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.union([
    z.object({ field: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/) }).strict(),
    z.object({ const: z.number().finite() }).strict(),
    z
      .object({ op: z.enum(['add', 'sub', 'mul', 'div']), args: z.array(exprSchema).min(2).max(6) })
      .strict(),
    z.object({ coalesce: z.array(exprSchema).min(2).max(6) }).strict(),
  ]),
);
