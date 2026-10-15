import { virtualColumns, type Expr, type RowRule, type ValueRule } from '@bizr/ingest';
import { z } from 'zod';

/**
 * The data-model proposal (AI_DESIGN Task A): how each detected table maps onto the pack's record
 * types, with which cleaning rules. Produced by the deterministic baseline proposer and/or the AI.
 *
 * This is a *wire* schema: it must be expressible as JSON Schema for structured outputs, so it has no
 * recursion and no open-ended maps (those become arrays of pairs) and every object is strict. Code
 * converts it to the internal rule types with `toRowRules` / `toValueRules` / `toExpr`.
 */

const text = (max: number) => z.string().max(max);
export const columnRefSchema = z.union([z.number().int().min(0).max(199), z.enum(virtualColumns)]);
export type WireColumnRef = z.infer<typeof columnRefSchema>;

export const wireValueRuleSchema = z.discriminatedUnion('rule', [
  z.object({ rule: z.literal('trim') }).strict(),
  z.object({ rule: z.literal('collapse_whitespace') }).strict(),
  z.object({ rule: z.literal('case'), to: z.enum(['upper', 'lower', 'title']) }).strict(),
  z.object({ rule: z.literal('null_if'), values: z.array(text(40)).max(30) }).strict(),
  z
    .object({
      rule: z.literal('parse_number'),
      decimalSeparator: z.enum(['.', ',']).optional(),
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
      trueValues: z.array(text(20)).max(20).optional(),
      falseValues: z.array(text(20)).max(20).optional(),
    })
    .strict(),
  z
    .object({
      rule: z.literal('strip_unit'),
      units: z.array(text(20)).min(1).max(20),
      factor: z.number().positive().max(10_000).optional(),
    })
    .strict(),
  z
    .object({
      rule: z.literal('map_values'),
      pairs: z.array(z.object({ from: text(80), to: text(80) }).strict()).max(60),
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
  z.object({ rule: z.literal('month_start'), year: z.number().int().min(1990).max(2100) }).strict(),
]);
export type WireValueRule = z.infer<typeof wireValueRuleSchema>;

export const wireRowRuleSchema = z.discriminatedUnion('rule', [
  z
    .object({
      rule: z.literal('skip_rows'),
      where: z
        .object({
          column: columnRefSchema,
          equals: z.array(text(80)).max(30).optional(),
          startsWith: z.array(text(80)).max(30).optional(),
          isEmpty: z.boolean().optional(),
        })
        .strict()
        .optional(),
      rows: z.array(z.number().int().min(1)).max(500).optional(),
      reason: text(120),
    })
    .strict(),
  z
    .object({
      rule: z.literal('fill_down'),
      columns: z.array(columnRefSchema).min(1).max(50),
      withinGroup: columnRefSchema.optional(),
    })
    .strict(),
  z
    .object({
      rule: z.literal('unpivot'),
      columns: z.array(z.number().int().min(0)).min(2).max(60),
    })
    .strict(),
]);
export type WireRowRule = z.infer<typeof wireRowRuleSchema>;

const fieldKey = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/);
const operand = z.union([
  z.object({ field: fieldKey }).strict(),
  z.object({ const: z.number() }).strict(),
]);
export const wireExprSchema = z.union([
  z
    .object({
      op: z.enum(['add', 'sub', 'mul', 'div']),
      args: z
        .array(
          z.union([
            operand,
            z
              .object({
                op: z.enum(['add', 'sub', 'mul', 'div']),
                args: z.array(operand).min(2).max(4),
              })
              .strict(),
          ]),
        )
        .min(2)
        .max(4),
    })
    .strict(),
  z.object({ coalesce: z.array(operand).min(2).max(4) }).strict(),
]);

export const fieldSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('column'), column: columnRefSchema }).strict(),
  /** First non-empty of several columns. */
  z
    .object({ kind: z.literal('first_of'), columns: z.array(columnRefSchema).min(2).max(5) })
    .strict(),
  z.object({ kind: z.literal('constant'), value: text(120) }).strict(),
  /** Computed from other fields of the same record (only when the record has no value of its own). */
  z.object({ kind: z.literal('derive'), expr: wireExprSchema }).strict(),
  /** 1, 2, 3… within consecutive rows that share this column's value (e.g. line number in an order). */
  z.object({ kind: z.literal('sequence'), within: columnRefSchema }).strict(),
]);
export type FieldSource = z.infer<typeof fieldSourceSchema>;

export const fieldMappingSchema = z
  .object({
    field: fieldKey,
    source: fieldSourceSchema,
    rules: z.array(wireValueRuleSchema).max(8),
    /** For reference fields: which target fields to match on, in order (e.g. ["sku", "name"]). */
    matchOn: z.array(fieldKey).max(4).optional(),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type FieldMapping = z.infer<typeof fieldMappingSchema>;

export const targetSchema = z
  .object({
    entity: fieldKey,
    /** `row`: one record per row. `group`: one record per distinct `groupBy` value (e.g. orders from item rows). */
    grain: z.enum(['row', 'group']),
    groupBy: z.array(columnRefSchema).max(3).optional(),
    /** Only rows matching this become records of this entity (e.g. negative quantities → returns). */
    where: z
      .object({
        column: columnRefSchema,
        op: z.enum(['negative', 'positive', 'not_empty', 'equals']),
        values: z.array(text(80)).max(20).optional(),
      })
      .strict()
      .optional(),
    fields: z.array(fieldMappingSchema).min(1).max(60),
  })
  .strict();
export type TargetMapping = z.infer<typeof targetSchema>;

export const sourceMappingSchema = z
  .object({
    /** Region id from the profile, e.g. "f0:1:0" (file 0, sheet 1, table 0). */
    sourceId: text(40),
    decision: z.enum(['map', 'ignore']),
    ignoreReason: text(160).optional(),
    knownFormat: text(40).optional(),
    rowRules: z.array(wireRowRuleSchema).max(12),
    targets: z.array(targetSchema).max(6),
  })
  .strict();
export type SourceMapping = z.infer<typeof sourceMappingSchema>;

/** What answering a review question changes. Applied by code, never by the AI. */
export const questionEffectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('keep_dedupe'), entity: fieldKey, canonical: text(120) }).strict(),
  z.object({ kind: z.literal('drop_dedupe'), entity: fieldKey, canonical: text(120) }).strict(),
  z
    .object({
      kind: z.literal('set_date_order'),
      sourceIds: z.array(text(40)).min(1).max(30),
      order: z.enum(['DMY', 'MDY', 'YMD']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('set_rules'),
      sourceId: text(40),
      entity: fieldKey,
      field: fieldKey,
      rules: z.array(wireValueRuleSchema).max(8),
    })
    .strict(),
  z.object({ kind: z.literal('ignore_source'), sourceId: text(40) }).strict(),
  z
    .object({
      kind: z.literal('unmap_field'),
      sourceId: text(40),
      entity: fieldKey,
      field: fieldKey,
    })
    .strict(),
]);
export type QuestionEffect = z.infer<typeof questionEffectSchema>;

export const proposalSchema = z
  .object({
    sources: z.array(sourceMappingSchema).max(60),
    /** Spelling variants to treat as one record, e.g. three spellings of the same customer. */
    dedupe: z
      .array(
        z
          .object({
            entity: fieldKey,
            clusters: z
              .array(
                z
                  .object({ canonical: text(120), variants: z.array(text(120)).min(1).max(20) })
                  .strict(),
              )
              .max(100),
          })
          .strict(),
      )
      .max(15),
    assumptions: z
      .array(
        z
          .object({
            id: text(40),
            about: text(80),
            text: text(300),
            confidence: z.number().min(0).max(1),
          })
          .strict(),
      )
      .max(30),
    questions: z
      .array(
        z
          .object({
            id: text(40),
            text: text(300),
            about: text(80),
            options: z
              .array(
                z.object({ id: text(40), label: text(80), effect: questionEffectSchema }).strict(),
              )
              .min(2)
              .max(4),
            defaultOption: text(40),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();
export type ModelProposal = z.infer<typeof proposalSchema>;

// --- Conversion to the internal cleaning-rule types ------------------------------------------------

export function toValueRules(rules: readonly WireValueRule[]): ValueRule[] {
  return rules.map((r): ValueRule => {
    if (r.rule === 'map_values') {
      const map: Record<string, string> = {};
      for (const p of r.pairs) map[p.from] = p.to;
      return { rule: 'map_values', map, ...(r.otherwise ? { otherwise: r.otherwise } : {}) };
    }
    return r;
  });
}

export function toRowRules(rules: readonly WireRowRule[]): RowRule[] {
  return rules.map((r) => r);
}

export function toExpr(expr: z.infer<typeof wireExprSchema>): Expr {
  return expr;
}
