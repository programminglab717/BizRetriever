import type { PackData, PackEntity } from '@bizr/packs';

import type { ChangeOp, ChangePlan, FieldDef } from './schema';

export function fieldDefFromPack(
  entity: PackEntity,
  field: PackEntity['fields'][number],
): FieldDef {
  const def: FieldDef = {
    key: field.id,
    label: field.label,
    type: field.type,
    required: field.required,
    pii: field.pii,
    packField: `${entity.id}.${field.id}`,
  };
  if (field.semantic) def.semantic = field.semantic;
  if (field.description) def.description = field.description;
  if (field.allowed_values) def.allowedValues = field.allowed_values;
  if (field.references) def.references = field.references;
  return def;
}

/**
 * A plan that creates the given pack entities (all fields), in an order where every link target is
 * created too. Entities referenced but not requested are added automatically.
 */
export function planFromPack(pack: PackData, entityIds: readonly string[]): ChangePlan {
  const byId = new Map(pack.entities.map((e) => [e.id, e]));
  const wanted = new Set<string>();
  const visit = (id: string) => {
    if (wanted.has(id)) return;
    const e = byId.get(id);
    if (!e) throw new Error(`Pack ${pack.manifest.id} has no entity "${id}"`);
    wanted.add(id);
    for (const f of e.fields) if (f.references) visit(f.references);
  };
  entityIds.forEach(visit);
  const ops: ChangeOp[] = pack.entities
    .filter((e) => wanted.has(e.id))
    .map((e) => ({
      op: 'create_entity',
      key: e.id,
      label: e.label,
      description: e.description,
      fields: e.fields.map((f) => fieldDefFromPack(e, f)),
      naturalKeys: e.natural_keys,
      ...(e.time_field ? { timeField: e.time_field } : {}),
      packEntity: e.id,
    }));
  return { ops };
}
