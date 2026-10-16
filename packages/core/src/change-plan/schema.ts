import { fieldSemantics, fieldTypes } from '@bizr/packs';
import { z } from 'zod';

/**
 * Change plans (ADR-008): the only way the structure of a tenant's data changes. Plans are produced
 * by ingestion (from an approved data-model proposal) or by the AI from a chat request, validated
 * here, and compiled to SQL by deterministic code. Never by the AI.
 */

export const keySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,40}$/, 'lowercase snake_case starting with a letter')
  .refine(
    (k) => !k.endsWith('_id') && !k.endsWith('_ref'),
    'keys ending in _id or _ref are reserved',
  );

export const fieldDefSchema = z
  .object({
    key: keySchema,
    label: z.string().min(1).max(80),
    type: z.enum(fieldTypes),
    semantic: z.enum(fieldSemantics).optional(),
    required: z.boolean().default(false),
    pii: z.boolean().default(false),
    description: z.string().max(300).optional(),
    allowedValues: z
      .array(z.string().regex(/^[a-z0-9_]{1,40}$/))
      .max(50)
      .optional(),
    /** Target entity key, for `reference` fields. */
    references: keySchema.optional(),
    /** Pack field this came from, e.g. "sale_line.quantity". */
    packField: z.string().max(80).optional(),
  })
  .strict()
  .superRefine((f, ctx) => {
    if ((f.type === 'reference') !== Boolean(f.references)) {
      ctx.addIssue({
        code: 'custom',
        message: 'reference fields (and only they) need `references`',
      });
    }
  });
export type FieldDef = z.infer<typeof fieldDefSchema>;

export const changeOpSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('create_entity'),
      key: keySchema,
      label: z
        .object({ singular: z.string().min(1).max(60), plural: z.string().min(1).max(60) })
        .strict(),
      description: z.string().max(300).default(''),
      fields: z.array(fieldDefSchema).min(1).max(150),
      naturalKeys: z.array(z.array(keySchema).min(1).max(5)).max(5).default([]),
      timeField: keySchema.optional(),
      /** Pack entity this came from; absent for custom entities. */
      packEntity: z.string().max(40).optional(),
    })
    .strict(),
  z.object({ op: z.literal('add_field'), entity: keySchema, field: fieldDefSchema }).strict(),
  z.object({ op: z.literal('remove_field'), entity: keySchema, field: keySchema }).strict(),
  z.object({ op: z.literal('remove_entity'), entity: keySchema }).strict(),
  z
    .object({
      op: z.literal('create_index'),
      entity: keySchema,
      fields: z.array(keySchema).min(1).max(4),
    })
    .strict(),
  /** What a record type is called. The data doesn't change. */
  z
    .object({
      op: z.literal('rename_entity'),
      entity: keySchema,
      label: z
        .object({ singular: z.string().min(1).max(60), plural: z.string().min(1).max(60) })
        .strict(),
    })
    .strict(),
  /** What a detail is called. The data doesn't change. */
  z
    .object({
      op: z.literal('rename_field'),
      entity: keySchema,
      field: keySchema,
      label: z.string().min(1).max(80),
    })
    .strict(),
  /** Turn a detail into another kind (text → number…). Values that can't be read become blank. */
  z
    .object({
      op: z.literal('change_field_type'),
      entity: keySchema,
      field: keySchema,
      type: z.enum(fieldTypes).exclude(['reference']),
    })
    .strict(),
  z
    .object({
      op: z.literal('add_allowed_values'),
      entity: keySchema,
      field: keySchema,
      values: z
        .array(z.string().regex(/^[a-z0-9_]{1,40}$/))
        .min(1)
        .max(50),
    })
    .strict(),
  /** The values stay on the records that have them; they just can't be chosen any more. */
  z
    .object({
      op: z.literal('remove_allowed_values'),
      entity: keySchema,
      field: keySchema,
      values: z
        .array(z.string().regex(/^[a-z0-9_]{1,40}$/))
        .min(1)
        .max(50),
    })
    .strict(),
  /** Unlink: the detail keeps the linked record's name as text. */
  z.object({ op: z.literal('remove_relationship'), entity: keySchema, field: keySchema }).strict(),
]);
export type ChangeOp = z.infer<typeof changeOpSchema>;

export const changePlanSchema = z.object({ ops: z.array(changeOpSchema).min(1).max(100) }).strict();
export type ChangePlan = z.infer<typeof changePlanSchema>;
