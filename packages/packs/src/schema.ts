import { z } from 'zod';

/** Pack manifest (`pack.yaml`), VERTICAL_PACKS.md §1.2. Other pack files get schemas as they land. */
export const packManifestSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/, 'lowercase letters, digits and _ only'),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'semver, e.g. 1.0.0'),
    name: z.string().min(1),
    description: z.string().min(1),
    industries_label: z.string().min(1),
    locale_defaults: z
      .object({
        currency: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code'),
        date_order: z.enum(['DMY', 'MDY', 'YMD']),
      })
      .strict(),
    requires_core: z.string().min(1),
    primary_time_entity: z.string().regex(/^[a-z0-9_]+$/),
  })
  .strict();

export type PackManifest = z.infer<typeof packManifestSchema>;

const id = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,40}$/, 'lowercase snake_case, starting with a letter');

export const fieldTypes = [
  'text',
  'integer',
  'decimal',
  'money',
  'percent',
  'date',
  'datetime',
  'boolean',
  'reference',
] as const;
export type FieldType = (typeof fieldTypes)[number];

export const fieldSemantics = [
  'name',
  'identifier',
  'email',
  'phone',
  'city',
  'region',
  'country',
  'postal_code',
  'category',
  'quantity',
  'unit_price',
  'unit_cost',
  'amount',
  'status',
  'channel',
  'note',
] as const;

export const packFieldSchema = z
  .object({
    id,
    label: z.string().min(1),
    type: z.enum(fieldTypes),
    semantic: z.enum(fieldSemantics).optional(),
    required: z.boolean().default(false),
    pii: z.boolean().default(false),
    description: z.string().optional(),
    /** Target entity id; required when type is `reference`, forbidden otherwise. */
    references: id.optional(),
    allowed_values: z.array(id).min(1).optional(),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (f.type === 'reference' && !f.references) {
      ctx.addIssue({ code: 'custom', message: 'reference fields need `references`' });
    }
    if (f.type !== 'reference' && f.references) {
      ctx.addIssue({ code: 'custom', message: '`references` is only allowed on reference fields' });
    }
    if (f.allowed_values && f.type !== 'text') {
      ctx.addIssue({ code: 'custom', message: '`allowed_values` is only allowed on text fields' });
    }
  });

export const packEntitySchema = z
  .object({
    id,
    label: z.object({ singular: z.string().min(1), plural: z.string().min(1) }).strict(),
    description: z.string().min(1),
    /** Alternative natural keys, most preferred first, used to match records across uploads. */
    natural_keys: z.array(z.array(id).min(1)).default([]),
    /** The field that places a record in time, if any (for dashboards and date filters). */
    time_field: id.optional(),
    fields: z.array(packFieldSchema).min(1),
  })
  .strict();

export const packEntitiesFileSchema = z
  .object({ entities: z.array(packEntitySchema).min(1) })
  .strict();

export type PackField = z.infer<typeof packFieldSchema>;
export type PackEntity = z.infer<typeof packEntitySchema>;

/** Cross-reference checks the per-object schemas can't express. Returns a list of problems. */
export function checkEntityReferences(entities: PackEntity[]): string[] {
  const problems: string[] = [];
  const entityIds = new Set<string>();
  for (const e of entities) {
    if (entityIds.has(e.id)) problems.push(`entity "${e.id}" is defined twice`);
    entityIds.add(e.id);
  }
  for (const e of entities) {
    const fieldIds = new Set<string>();
    for (const f of e.fields) {
      if (fieldIds.has(f.id)) problems.push(`${e.id}.${f.id} is defined twice`);
      fieldIds.add(f.id);
      if (f.references && !entityIds.has(f.references)) {
        problems.push(`${e.id}.${f.id} references unknown entity "${f.references}"`);
      }
    }
    for (const key of e.natural_keys) {
      for (const k of key) {
        if (!fieldIds.has(k)) problems.push(`${e.id} natural key uses unknown field "${k}"`);
      }
    }
    if (e.time_field) {
      const tf = e.fields.find((f) => f.id === e.time_field);
      if (!tf) problems.push(`${e.id} time_field "${e.time_field}" is not a field`);
      else if (tf.type !== 'date' && tf.type !== 'datetime') {
        problems.push(`${e.id} time_field "${e.time_field}" must be a date or datetime`);
      }
    }
  }
  return problems;
}
