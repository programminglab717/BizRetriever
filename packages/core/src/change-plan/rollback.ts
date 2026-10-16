import { ident, qualified } from '../sql/ident';
import { ChangePlanError, compileChangePlan, indexName, type CatalogEntity } from './compile';
import { columnsFor, SYSTEM_COLUMNS } from './names';
import type { ChangeOp, ChangePlan } from './schema';

/**
 * Undoing a structural change (ARCHITECTURE §8, ADR-044). Pure. Each op of the change is undone in
 * reverse order: ops with an exact inverse (renames, added details, widened kinds, list values) run
 * that inverse; ops that dropped or rewrote data (removed details or record types, narrowed kinds,
 * removed links) are restored from the snapshot taken before the change. Either way the catalog ends
 * as it was before the change.
 */

export interface RollbackStep {
  op: ChangeOp;
  /** `inverse`: replayed backwards; `restore`: copied back from the snapshot. */
  how: 'inverse' | 'restore';
  /** For `inverse` steps that drop data themselves (e.g. removing a detail people filled in). */
  destructive: boolean;
}

export interface CompiledRollback {
  statements: string[];
  /** Equal to the catalog before the change. */
  catalog: CatalogEntity[];
  steps: RollbackStep[];
  /** Tables copied back from the snapshot: rows added since won't get the restored values. */
  restores: { table: string; snapshotTable: string; columns: string[]; wholeTable: boolean }[];
  /** Tables an inverse step drops data from (worth a snapshot of their own before rolling back). */
  snapshotTables: string[];
}

export function compileRollback(input: {
  tenantSchema: string;
  /** The catalog now (just after the change; only the latest change can be undone). */
  now: readonly CatalogEntity[];
  /** The catalog just before the change. */
  before: readonly CatalogEntity[];
  forward: ChangePlan;
  /** Live table name → snapshot table name (in `<schema>_snap`), or null when none was taken. */
  snapshots: Readonly<Record<string, string>> | null;
}): CompiledRollback {
  const { tenantSchema } = input;
  const snapSchema = `${tenantSchema}_snap`;
  // The catalog before each forward op.
  const states: CatalogEntity[][] = [];
  let walk: CatalogEntity[] = structuredClone([...input.before]);
  for (const op of input.forward.ops) {
    states.push(walk);
    walk = compileChangePlan(tenantSchema, walk, { ops: [op] }).catalog;
  }

  let running: CatalogEntity[] = structuredClone([...input.now]);
  const statements: string[] = [];
  const steps: RollbackStep[] = [];
  const restores: CompiledRollback['restores'] = [];
  const snapshotTables = new Set<string>();
  const run = (ops: ChangeOp[]) => {
    const c = compileChangePlan(tenantSchema, running, { ops });
    statements.push(...c.statements);
    running = c.catalog;
    for (const t of c.snapshotTables) snapshotTables.add(t);
    return c;
  };
  const snapOf = (table: string) => {
    const snap = input.snapshots?.[table];
    if (!snap)
      throw new ChangePlanError([
        `the copy kept for undoing this change is gone (it is kept for 30 days), so it can't be undone`,
      ]);
    return snap;
  };
  const copyBack = (table: string, columns: string[]) => {
    const snap = snapOf(table);
    statements.push(
      `UPDATE ${qualified(tenantSchema, table)} AS live SET ${columns.map((c) => `${ident(c)} = s.${ident(c)}`).join(', ')} FROM ${qualified(snapSchema, snap)} AS s WHERE live."_id" = s."_id"`,
    );
    restores.push({ table, snapshotTable: snap, columns, wholeTable: false });
  };

  for (let i = input.forward.ops.length - 1; i >= 0; i--) {
    const op = input.forward.ops[i]!;
    const prior = states[i]!;
    const single = compileChangePlan(tenantSchema, prior, { ops: [op] });
    if (op.op === 'create_index') continue; // harmless to keep
    if (single.inverse) {
      const c = run(single.inverse.ops);
      for (const inv of single.inverse.ops)
        steps.push({ op: inv, how: 'inverse', destructive: c.destructive });
      continue;
    }
    const entityBefore = prior.find((e) => e.key === ('entity' in op ? op.entity : ''));
    switch (op.op) {
      case 'remove_field': {
        const def = entityBefore!.fields.find((f) => f.key === op.field)!;
        run([{ op: 'add_field', entity: op.entity, field: def }]);
        const cols = columnsFor(def);
        copyBack(
          entityBefore!.tableName,
          [cols.value, cols.fk, cols.ref].filter((c): c is string => !!c),
        );
        break;
      }
      case 'remove_entity': {
        const e = entityBefore!;
        run([
          {
            op: 'create_entity',
            key: e.key,
            label: e.label,
            description: e.description,
            fields: e.fields,
            naturalKeys: e.naturalKeys,
            ...(e.timeField ? { timeField: e.timeField } : {}),
            ...(e.packEntity ? { packEntity: e.packEntity } : {}),
          },
        ]);
        const snap = snapOf(e.tableName);
        const cols = [
          ...SYSTEM_COLUMNS.map((c) => c.split(' ')[0]!),
          ...e.fields.flatMap((f) => {
            const c = columnsFor(f);
            return [c.value, c.fk, c.ref].filter((x): x is string => !!x);
          }),
        ].map(ident);
        statements.push(
          `INSERT INTO ${qualified(tenantSchema, e.tableName)} (${cols.join(', ')}) OVERRIDING SYSTEM VALUE SELECT ${cols.join(', ')} FROM ${qualified(snapSchema, snap)}`,
          `SELECT setval(pg_get_serial_sequence('${qualified(tenantSchema, e.tableName).replace(/'/g, "''")}', '_id'), GREATEST((SELECT max("_id") FROM ${qualified(tenantSchema, e.tableName)}), 1))`,
        );
        restores.push({ table: e.tableName, snapshotTable: snap, columns: [], wholeTable: true });
        break;
      }
      case 'change_field_type': {
        const def = entityBefore!.fields.find((f) => f.key === op.field)!;
        const back: ChangeOp[] = [
          {
            op: 'change_field_type',
            entity: op.entity,
            field: op.field,
            type: def.type as Exclude<typeof def.type, 'reference'>,
          },
        ];
        if (def.allowedValues?.length)
          back.push({
            op: 'add_allowed_values',
            entity: op.entity,
            field: op.field,
            values: def.allowedValues,
          });
        run(back);
        copyBack(entityBefore!.tableName, [def.key]);
        break;
      }
      case 'remove_relationship': {
        const def = entityBefore!.fields.find((f) => f.key === op.field)!;
        const cols = columnsFor(def);
        const t = qualified(tenantSchema, entityBefore!.tableName);
        const target = prior.find((x) => x.key === def.references)!;
        statements.push(
          `ALTER TABLE ${t} RENAME COLUMN ${ident(def.key)} TO ${ident(cols.ref!)}`,
          `ALTER TABLE ${t} ADD COLUMN ${ident(cols.fk!)} bigint`,
        );
        copyBack(entityBefore!.tableName, [cols.fk!]);
        statements.push(
          `ALTER TABLE ${t} ADD CONSTRAINT ${ident(indexName(entityBefore!.tableName, [cols.fk!]).replace(/_idx$/, '_fk'))} FOREIGN KEY (${ident(cols.fk!)}) REFERENCES ${qualified(tenantSchema, target.tableName)} ("_id") ON DELETE SET NULL`,
          `CREATE INDEX ${ident(indexName(entityBefore!.tableName, [cols.fk!]))} ON ${t} (${ident(cols.fk!)})`,
        );
        running = running.map((e) =>
          e.key === op.entity
            ? { ...e, fields: e.fields.map((f) => (f.key === op.field ? def : f)) }
            : e,
        );
        break;
      }
      default:
        throw new ChangePlanError([`op ${i + 1} (${op.op}) can't be undone`]);
    }
    steps.push({ op, how: 'restore', destructive: false });
  }
  return {
    statements,
    catalog: structuredClone([...input.before]),
    steps,
    restores,
    snapshotTables: [...snapshotTables],
  };
}

/** What changed between two catalogs, for the control-plane catalog writer. */
export function catalogDelta(from: readonly CatalogEntity[], to: readonly CatalogEntity[]) {
  const a = new Map(from.map((e) => [e.key, e]));
  const b = new Map(to.map((e) => [e.key, e]));
  const delta = {
    createdEntities: [...b.keys()].filter((k) => !a.has(k)),
    removedEntities: [...a.keys()].filter((k) => !b.has(k)),
    addedFields: [] as { entity: string; field: string }[],
    removedFields: [] as { entity: string; field: string }[],
    changedEntities: [] as string[],
    changedFields: [] as { entity: string; field: string }[],
  };
  for (const [key, e] of b) {
    const old = a.get(key);
    if (!old) continue;
    if (old.label.singular !== e.label.singular || old.label.plural !== e.label.plural)
      delta.changedEntities.push(key);
    for (const f of e.fields) {
      const of = old.fields.find((x) => x.key === f.key);
      if (!of) delta.addedFields.push({ entity: key, field: f.key });
      else if (JSON.stringify(of) !== JSON.stringify(f))
        delta.changedFields.push({ entity: key, field: f.key });
    }
    for (const f of old.fields)
      if (!e.fields.some((x) => x.key === f.key))
        delta.removedFields.push({ entity: key, field: f.key });
  }
  return delta;
}
