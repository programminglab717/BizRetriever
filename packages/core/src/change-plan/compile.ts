import { createHash } from 'node:crypto';

import { ident, qualified } from '../sql/ident';
import { columnsFor, SQL_TYPES, SYSTEM_COLUMNS, tableNameFor } from './names';
import { changePlanSchema, type ChangeOp, type ChangePlan, type FieldDef } from './schema';

/** What the compiler needs to know about the tenant's current structure. */
export interface CatalogEntity {
  key: string;
  tableName: string;
  label: { singular: string; plural: string };
  description: string;
  fields: FieldDef[];
  naturalKeys: string[][];
  timeField?: string | undefined;
  packEntity?: string | undefined;
}

export interface CompiledPlan {
  /** SQL to run, in order, in one transaction, as the tenant-owning admin role. */
  statements: string[];
  /** The catalog after the plan is applied. */
  catalog: CatalogEntity[];
  /** Entities and fields added/removed, for the control-plane catalog writer. */
  delta: {
    createdEntities: string[];
    removedEntities: string[];
    addedFields: { entity: string; field: string }[];
    removedFields: { entity: string; field: string }[];
  };
  /** A plan that undoes this one, when that is possible without a snapshot. */
  inverse: ChangePlan | null;
  /** True if the plan drops anything (needs typed confirmation and a snapshot first). */
  destructive: boolean;
}

export class ChangePlanError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid change plan:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
}

function indexName(table: string, columns: string[]): string {
  const base = `${table}_${columns.join('_')}_idx`;
  if (base.length <= 63) return base;
  const hash = createHash('sha256').update(base).digest('hex').slice(0, 8);
  return `${base.slice(0, 54)}_${hash}`;
}

function columnDefs(field: FieldDef, inNewTable: boolean): string[] {
  const cols = columnsFor(field);
  if (cols.fk && cols.ref) {
    const notNull = field.required && inNewTable ? ' NOT NULL' : '';
    return [`${ident(cols.fk)} bigint`, `${ident(cols.ref)} text${notNull}`];
  }
  const sqlType = SQL_TYPES[field.type];
  if (!sqlType) throw new ChangePlanError([`unknown field type ${field.type}`]);
  // NOT NULL only on brand-new tables; existing rows can't satisfy a new required column.
  return [`${ident(cols.value!)} ${sqlType}${field.required && inNewTable ? ' NOT NULL' : ''}`];
}

/**
 * Compiles a change plan against the current catalog. Pure and deterministic: same input, same SQL.
 * Throws ChangePlanError listing every problem; nothing is partially compiled.
 */
export function compileChangePlan(
  tenantSchema: string,
  current: readonly CatalogEntity[],
  input: ChangePlan,
): CompiledPlan {
  const plan = changePlanSchema.parse(input);
  const problems: string[] = [];
  const catalog = new Map(current.map((e) => [e.key, structuredClone(e)]));
  const tables = new Set(current.map((e) => e.tableName));
  const statements: string[] = [];
  const fkStatements: string[] = [];
  const delta: CompiledPlan['delta'] = {
    createdEntities: [],
    removedEntities: [],
    addedFields: [],
    removedFields: [],
  };
  const inverseOps: ChangeOp[] = [];
  let destructive = false;
  let invertible = true;

  const table = (entityKey: string) => qualified(tenantSchema, catalog.get(entityKey)!.tableName);
  const pendingRefs: { entity: string; field: FieldDef }[] = [];

  const addFk = (entityKey: string, field: FieldDef) => {
    pendingRefs.push({ entity: entityKey, field });
  };

  for (const [i, op] of plan.ops.entries()) {
    const where = `op ${i + 1} (${op.op})`;
    switch (op.op) {
      case 'create_entity': {
        const tableName = tableNameFor(op.key);
        if (catalog.has(op.key)) problems.push(`${where}: "${op.key}" already exists`);
        if (tables.has(tableName))
          problems.push(`${where}: table name ${tableName} is already used`);
        const keys = new Set<string>();
        for (const f of op.fields) {
          if (keys.has(f.key)) problems.push(`${where}: field "${f.key}" is listed twice`);
          keys.add(f.key);
        }
        for (const nk of op.naturalKeys) {
          for (const k of nk)
            if (!keys.has(k)) problems.push(`${where}: natural key uses unknown field "${k}"`);
        }
        if (op.timeField) {
          const tf = op.fields.find((f) => f.key === op.timeField);
          if (!tf || (tf.type !== 'date' && tf.type !== 'datetime')) {
            problems.push(
              `${where}: time field "${op.timeField}" must be a date field of this entity`,
            );
          }
        }
        if (problems.length > 0) break;
        catalog.set(op.key, {
          key: op.key,
          tableName,
          label: op.label,
          description: op.description,
          fields: op.fields,
          naturalKeys: op.naturalKeys,
          timeField: op.timeField,
          packEntity: op.packEntity,
        });
        tables.add(tableName);
        const cols = [...SYSTEM_COLUMNS, ...op.fields.flatMap((f) => columnDefs(f, true))];
        statements.push(`CREATE TABLE ${table(op.key)} (\n  ${cols.join(',\n  ')}\n)`);
        statements.push(
          `CREATE INDEX ${ident(indexName(tableName, ['_natural_key']))} ON ${table(op.key)} (${ident('_natural_key')})`,
        );
        if (op.timeField) {
          statements.push(
            `CREATE INDEX ${ident(indexName(tableName, [op.timeField]))} ON ${table(op.key)} (${ident(op.timeField)})`,
          );
        }
        for (const f of op.fields) if (f.type === 'reference') addFk(op.key, f);
        delta.createdEntities.push(op.key);
        inverseOps.unshift({ op: 'remove_entity', entity: op.key });
        break;
      }
      case 'add_field': {
        const entity = catalog.get(op.entity);
        if (!entity) {
          problems.push(`${where}: unknown entity "${op.entity}"`);
          break;
        }
        if (entity.fields.some((f) => f.key === op.field.key)) {
          problems.push(`${where}: "${op.entity}.${op.field.key}" already exists`);
          break;
        }
        entity.fields.push(op.field);
        for (const def of columnDefs(op.field, false))
          statements.push(`ALTER TABLE ${table(op.entity)} ADD COLUMN ${def}`);
        if (op.field.type === 'reference') addFk(op.entity, op.field);
        delta.addedFields.push({ entity: op.entity, field: op.field.key });
        inverseOps.unshift({ op: 'remove_field', entity: op.entity, field: op.field.key });
        break;
      }
      case 'remove_field': {
        const entity = catalog.get(op.entity);
        const field = entity?.fields.find((f) => f.key === op.field);
        if (!entity || !field) {
          problems.push(`${where}: unknown field "${op.entity}.${op.field}"`);
          break;
        }
        if (entity.naturalKeys.some((k) => k.includes(op.field)) || entity.timeField === op.field) {
          problems.push(
            `${where}: "${op.entity}.${op.field}" is used to match or date records; change that first`,
          );
          break;
        }
        entity.fields = entity.fields.filter((f) => f.key !== op.field);
        const cols = columnsFor(field);
        for (const c of [cols.value, cols.fk, cols.ref].filter((c): c is string => Boolean(c))) {
          statements.push(`ALTER TABLE ${table(op.entity)} DROP COLUMN ${ident(c)}`);
        }
        delta.removedFields.push({ entity: op.entity, field: op.field });
        destructive = true;
        invertible = false;
        break;
      }
      case 'remove_entity': {
        const entity = catalog.get(op.entity);
        if (!entity) {
          problems.push(`${where}: unknown entity "${op.entity}"`);
          break;
        }
        const referencedBy = [...catalog.values()].filter(
          (e) => e.key !== op.entity && e.fields.some((f) => f.references === op.entity),
        );
        if (referencedBy.length > 0) {
          problems.push(
            `${where}: "${op.entity}" is linked from ${referencedBy.map((e) => `"${e.key}"`).join(', ')}`,
          );
          break;
        }
        statements.push(`DROP TABLE ${table(op.entity)}`);
        tables.delete(entity.tableName);
        catalog.delete(op.entity);
        delta.removedEntities.push(op.entity);
        destructive = true;
        invertible = false;
        break;
      }
      case 'create_index': {
        const entity = catalog.get(op.entity);
        if (!entity) {
          problems.push(`${where}: unknown entity "${op.entity}"`);
          break;
        }
        const columns: string[] = [];
        for (const key of op.fields) {
          const f = entity.fields.find((x) => x.key === key);
          if (!f) problems.push(`${where}: unknown field "${op.entity}.${key}"`);
          else columns.push(columnsFor(f).value ?? columnsFor(f).fk!);
        }
        if (columns.length === op.fields.length) {
          statements.push(
            `CREATE INDEX IF NOT EXISTS ${ident(indexName(entity.tableName, columns))} ON ${table(op.entity)} (${columns.map(ident).join(', ')})`,
          );
        }
        break;
      }
    }
  }

  // Foreign keys last, once every table in the plan exists.
  for (const { entity, field } of pendingRefs) {
    const target = catalog.get(field.references!);
    if (!target) {
      problems.push(`"${entity}.${field.key}" links to unknown entity "${field.references}"`);
      continue;
    }
    const source = catalog.get(entity)!;
    const { fk } = columnsFor(field);
    fkStatements.push(
      `ALTER TABLE ${table(entity)} ADD CONSTRAINT ${ident(indexName(source.tableName, [fk!]).replace(/_idx$/, '_fk'))} FOREIGN KEY (${ident(fk!)}) REFERENCES ${table(target.key)} (${ident('_id')}) ON DELETE SET NULL`,
      `CREATE INDEX ${ident(indexName(source.tableName, [fk!]))} ON ${table(entity)} (${ident(fk!)})`,
    );
  }

  if (problems.length > 0) throw new ChangePlanError(problems);
  return {
    statements: [...statements, ...fkStatements],
    catalog: [...catalog.values()],
    delta,
    inverse: invertible && inverseOps.length > 0 ? { ops: inverseOps } : null,
    destructive,
  };
}
