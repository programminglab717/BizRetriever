import { normalizeLoose } from '@bizr/ingest';
import { z } from 'zod';

import { loadCatalog } from '../change-plan/apply';
import type { CatalogEntity } from '../change-plan/compile';
import { columnsFor } from '../change-plan/names';
import { keySchema, type FieldDef } from '../change-plan/schema';
import { bumpDataVersion } from '../dashboard/service';
import { executeTenantQuery } from '../executor/execute';
import { withTenantWriter, type TenantWriter } from '../executor/write';
import { asText } from '../merge/diff';
import { ident } from '../sql/ident';
import { requireEditor, type MemberWorkspace } from '../workspaces/service';
import { ensureEditLog, logEdits, type LoggedEdit } from './edits';
import { bestMatches, type Candidate } from './lookup';
import { RecordsError } from './service';
import { parseEditValue, titleFieldOf } from './values';

/**
 * Adding or changing records by chat (Task H, PRODUCT_SPEC §4.3). A plan (from rules or the AI) says
 * what to write; code checks every value against its field, fills in defaults it can look up (a
 * product's price) and says so, works out totals, and renders the confirmation card. Nothing is
 * written until the owner taps "Add it". Writes run as the tenant writer, logged for undo.
 */

const valueSchema = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);
const refSchema = z.union([
  z.object({ candidateId: z.string().regex(/^\d{1,18}$/) }).strict(),
  z.object({ createNew: z.object({ values: z.record(keySchema, valueSchema) }).strict() }).strict(),
]);
const partSchema = z
  .object({
    values: z.record(keySchema, valueSchema).default({}),
    references: z.record(keySchema, refSchema).default({}),
  })
  .strict();

export const recordWritePlanSchema = z
  .object({
    operation: z.enum(['insert', 'update']),
    entity: keySchema,
    records: z
      .array(
        partSchema.extend({
          /** update: the record to change (an id from the lookups). */
          id: z
            .string()
            .regex(/^\d{1,18}$/)
            .optional(),
          /** Items on it: records of a type that links to this one (sale items on a sale). */
          lines: z
            .array(partSchema.extend({ entity: keySchema }))
            .max(50)
            .default([]),
        }),
      )
      .max(20),
    assumptions: z
      .array(z.object({ text: z.string().min(1).max(300) }).strict())
      .max(10)
      .default([]),
    clarify: z
      .object({
        question: z.string().min(1).max(200),
        options: z.array(z.string().min(1).max(120)).min(2).max(6),
      })
      .strict()
      .optional(),
  })
  .strict();
export type RecordWritePlan = z.infer<typeof recordWritePlanSchema>;

type Value = string | boolean | null;

/** A record ready to write: parsed values and resolved links. */
interface Prepared {
  entity: CatalogEntity;
  id?: string;
  values: Record<string, Value>;
  links: Record<string, { id: string; title: string } | { create: Prepared }>;
  lines: Prepared[];
  /** update: the values before. */
  before?: Record<string, Value>;
  title?: string;
}

export interface WriteCard {
  title: string;
  rows: { label: string; value: string; isNew?: boolean; before?: string }[];
  items: { text: string; total: string | null }[];
  total: string | null;
  /** "New customer “Bloom & Co”" — new linked records are always shown. */
  creates: string[];
  assumptions: string[];
  action: string;
}

const today = (tz: string, now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
const localNow = (tz: string, now = new Date()) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
};

async function rowsOf(member: MemberWorkspace, sql: string, params: unknown[] = []) {
  return (
    await executeTenantQuery({
      tenant: { workspaceId: member.workspace.id, tenantSchema: member.workspace.tenantSchema },
      sql,
      params,
      origin: 'records',
      path: 'system',
      rowLimit: 20_000,
    })
  ).rows;
}

/** Records whose name (or code) matches what was typed. */
export async function lookupRecords(
  member: MemberWorkspace,
  entity: CatalogEntity,
  mention: string,
): Promise<Candidate[]> {
  const title = titleFieldOf(entity.fields);
  if (!title) return [];
  const ids = entity.fields.filter(
    (f) => f.type === 'text' && f.semantic === 'identifier' && f.key !== title,
  );
  const rows = await rowsOf(
    member,
    `SELECT "_id"::text AS id, ${ident(title)}::text AS title${ids.map((f, i) => `, ${ident(f.key)}::text AS ${ident(`a${i}`)}`).join('')}
     FROM ${ident(entity.tableName)} WHERE "_deleted_at" IS NULL AND ${ident(title)} IS NOT NULL`,
  );
  return bestMatches(
    mention,
    rows.map((r) => ({
      id: String(r.id as string),
      title: String(r.title as string),
      also: ids.map((_, i) => r[`a${i}`]).filter((x): x is string => typeof x === 'string'),
    })),
  );
}

function parseValue(f: FieldDef, raw: unknown, clock?: { tz: string; now: Date }): Value {
  let text = typeof raw === 'number' ? String(raw) : raw;
  // A day for a date-and-time: now if it's today, else midday (so it lands on that day anywhere).
  if (
    f.type === 'datetime' &&
    typeof text === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(text.trim()) &&
    clock
  )
    text =
      text.trim() === today(clock.tz, clock.now)
        ? localNow(clock.tz, clock.now)
        : `${text.trim()}T12:00:00`;
  const r = parseEditValue(f, text);
  if (!r.ok) throw new RecordsError(r.error);
  return r.value;
}

const money = (n: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
const num = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(n);

/**
 * Checks a plan against the catalog and the data, fills defaults, and renders the card. Throws a
 * RecordsError (plain words) for anything that can't be written.
 */
export async function prepareRecordWrite(
  member: MemberWorkspace,
  plan: RecordWritePlan,
  now = new Date(),
): Promise<{ prepared: Prepared[]; card: WriteCard }> {
  const catalog = await loadCatalog(member.workspace.id);
  const tz = member.settings.timezone;
  const currency = member.settings.currency;
  const assumptions = plan.assumptions.map((a) => a.text);
  const creates: string[] = [];
  const entityOf = (key: string) => {
    const e = catalog.find((c) => c.key === key);
    if (!e) throw new RecordsError('I can’t add that kind of record.');
    return e;
  };

  const preparePart = async (
    e: CatalogEntity,
    part: {
      values: Record<string, unknown>;
      references: RecordWritePlan['records'][number]['references'];
    },
  ): Promise<Prepared> => {
    const values: Record<string, Value> = {};
    for (const [k, v] of Object.entries(part.values)) {
      const f = e.fields.find((x) => x.key === k && x.type !== 'reference');
      if (!f) throw new RecordsError(`${e.label.plural} don’t have a “${k.replace(/_/g, ' ')}”.`);
      values[k] = parseValue(f, v, { tz, now });
    }
    const links: Prepared['links'] = {};
    for (const [k, ref] of Object.entries(part.references)) {
      const f = e.fields.find((x) => x.key === k && x.type === 'reference');
      if (!f?.references) throw new RecordsError(`${e.label.plural} can’t be linked that way.`);
      const target = entityOf(f.references);
      if ('candidateId' in ref) {
        const t = titleFieldOf(target.fields);
        const [row] = await rowsOf(
          member,
          `SELECT ${t ? `${ident(t)}::text` : 'NULL::text'} AS title FROM ${ident(target.tableName)} WHERE "_id" = $1::bigint AND "_deleted_at" IS NULL`,
          [ref.candidateId],
        );
        if (!row)
          throw new RecordsError(`I couldn’t find that ${target.label.singular.toLowerCase()}.`);
        links[k] = {
          id: ref.candidateId,
          title: (row.title as string | null) ?? `${target.label.singular} #${ref.candidateId}`,
        };
      } else {
        const created = await preparePart(target, { values: ref.createNew.values, references: {} });
        const name = created.values[titleFieldOf(target.fields) ?? ''];
        creates.push(`New ${target.label.singular.toLowerCase()} “${String(name ?? '')}”`);
        links[k] = { create: created };
      }
    }
    return { entity: e, values, links, lines: [] };
  };

  const entity = entityOf(plan.entity);
  const prepared: Prepared[] = [];
  for (const r of plan.records) {
    const p = await preparePart(entity, r);
    if (plan.operation === 'update') {
      if (!r.id)
        throw new RecordsError(`Which ${entity.label.singular.toLowerCase()} should I change?`);
      if (r.lines.length)
        throw new RecordsError('I can only change the details of one record at a time.');
      const cols = Object.keys(p.values).concat(Object.keys(p.links));
      if (cols.length === 0) throw new RecordsError('What should I change?');
      const t = titleFieldOf(entity.fields);
      const shown = entity.fields.filter((f) => cols.includes(f.key));
      const withTime = shown.some((f) => f.type === 'datetime');
      const [row] = await rowsOf(
        member,
        `SELECT ${t ? `${ident(t)}::text` : 'NULL::text'} AS "_title"${shown
          .map((f) => {
            const c = columnsFor(f);
            return `, ${f.type === 'datetime' ? `to_char(${ident(f.key)} AT TIME ZONE $2, 'YYYY-MM-DD"T"HH24:MI:SS')` : `${ident(c.value ?? c.ref!)}::text`} AS ${ident(f.key)}`;
          })
          .join(
            '',
          )} FROM ${ident(entity.tableName)} WHERE "_id" = $1::bigint AND "_deleted_at" IS NULL`,
        withTime ? [r.id, tz] : [r.id],
      );
      if (!row)
        throw new RecordsError(
          `I couldn’t find that ${entity.label.singular.toLowerCase()}. It may have been deleted.`,
        );
      p.id = r.id;
      p.title = (row._title as string | null) ?? `${entity.label.singular} #${r.id}`;
      p.before = Object.fromEntries(cols.map((c) => [c, (row[c] as string | null) ?? null]));
    } else {
      for (const line of r.lines) {
        const le = entityOf(line.entity);
        if (!le.fields.some((f) => f.type === 'reference' && f.references === entity.key))
          throw new RecordsError(
            `${le.label.plural} can’t be added to a ${entity.label.singular.toLowerCase()}.`,
          );
        p.lines.push(await preparePart(le, line));
      }
    }
    prepared.push(p);
  }
  if (prepared.length === 0) throw new RecordsError('There’s nothing to add.');

  // Defaults code can look up, each stated on the card.
  if (plan.operation === 'insert')
    for (const p of prepared) {
      const timeField = p.entity.timeField
        ? p.entity.fields.find((f) => f.key === p.entity.timeField)
        : undefined;
      if (timeField && p.values[timeField.key] === undefined) {
        p.values[timeField.key] = timeField.type === 'date' ? today(tz, now) : localNow(tz, now);
        assumptions.push(`${timeField.label}: I used today.`);
      }
      const status = p.entity.fields.find(
        (f) => f.key === 'status' && f.allowedValues?.includes('completed'),
      );
      if (status && p.values.status === undefined) p.values.status = 'completed';
      let sum = 0;
      let summed = p.lines.length > 0;
      for (const [i, line] of p.lines.entries()) {
        const product = Object.entries(line.links).find(
          ([k]) => line.entity.fields.find((f) => f.key === k)?.references === 'product',
        )?.[1];
        const has = (k: string) => line.entity.fields.some((f) => f.key === k);
        if (has('line_number') && line.values.line_number === undefined)
          line.values.line_number = String(i + 1);
        if (product && 'id' in product) {
          const [row] = await rowsOf(
            member,
            `SELECT unit_price::text AS price, unit_cost::text AS cost FROM ${ident(entityOf('product').tableName)} WHERE "_id" = $1::bigint`,
            [product.id],
          ).catch(() => []);
          if (has('unit_price') && line.values.unit_price === undefined && row?.price) {
            line.values.unit_price = asText(row.price);
            assumptions.push(
              `Price for ${product.title}: its selling price, ${money(Number(row.price), currency)}.`,
            );
          }
          if (has('unit_cost_at_sale') && line.values.unit_cost_at_sale === undefined && row?.cost)
            line.values.unit_cost_at_sale = asText(row.cost);
        }
        const qty = Number(line.values.quantity ?? NaN);
        const price = Number(line.values.unit_price ?? NaN);
        if (
          has('line_total') &&
          line.values.line_total === undefined &&
          Number.isFinite(qty) &&
          Number.isFinite(price)
        )
          line.values.line_total = (Math.round(qty * price * 10_000) / 10_000).toFixed(4);
        const lt = Number(line.values.line_total ?? NaN);
        if (Number.isFinite(lt)) sum += lt;
        else summed = false;
      }
      if (summed && p.entity.fields.some((f) => f.key === 'total') && p.values.total === undefined)
        p.values.total = sum.toFixed(4);
    }

  // Required details must be there (an item's link to its sale is filled in when writing).
  const checkRequired = (p: Prepared, parent?: string) => {
    if (p.id) return;
    for (const f of p.entity.fields) {
      if (!f.required) continue;
      const missing =
        f.type === 'reference'
          ? f.references !== parent && !p.links[f.key]
          : p.values[f.key] == null;
      if (missing)
        throw new RecordsError(`A ${p.entity.label.singular.toLowerCase()} needs “${f.label}”.`);
    }
    for (const l of p.lines) checkRequired(l, p.entity.key);
    for (const link of Object.values(p.links)) if ('create' in link) checkRequired(link.create);
  };
  for (const p of prepared) checkRequired(p);

  return {
    prepared,
    card: cardFor(plan.operation, prepared, { tz, currency, now, creates, assumptions }),
  };
}

function display(f: FieldDef, v: Value, ctx: { currency: string; tz: string; now: Date }): string {
  if (v === null) return 'blank';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (f.type === 'money') return money(Number(v), ctx.currency);
  if (['decimal', 'integer'].includes(f.type)) return num(Number(v));
  if (f.type === 'percent') return `${num(Number(v) * 100)}%`;
  if (f.type === 'date' || f.type === 'datetime') {
    const d = v.slice(0, 10);
    const label = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${d}T12:00:00Z`),
    );
    return d === today(ctx.tz, ctx.now) ? `Today (${label})` : label;
  }
  if (f.allowedValues?.length) return v.replace(/_/g, ' ');
  return v;
}

function cardFor(
  operation: 'insert' | 'update',
  prepared: Prepared[],
  ctx: { tz: string; currency: string; now: Date; creates: string[]; assumptions: string[] },
): WriteCard {
  const first = prepared[0]!;
  const e = first.entity;
  const linkTitle = (l: Prepared['links'][string]) =>
    'id' in l ? l.title : String(l.create.values[titleFieldOf(l.create.entity.fields) ?? ''] ?? '');
  const rows: WriteCard['rows'] = [];
  for (const p of prepared)
    for (const f of p.entity.fields) {
      if (f.key in p.values && !(operation === 'insert' && f.key === 'total' && p.lines.length)) {
        const v = p.values[f.key]!;
        rows.push({
          label: f.label,
          value: display(f, v, ctx),
          ...(p.before ? { before: display(f, (p.before[f.key] as Value) ?? null, ctx) } : {}),
        });
      }
      const l = p.links[f.key];
      if (l)
        rows.push({
          label: f.label,
          value: linkTitle(l),
          ...('create' in l ? { isNew: true } : {}),
          ...(p.before ? { before: (p.before[f.key] as string | null) ?? 'blank' } : {}),
        });
    }
  const items = first.lines.map((line) => {
    const product = Object.entries(line.links)[0]?.[1];
    const qty = line.values.quantity;
    const price = line.values.unit_price;
    const total = line.values.line_total;
    return {
      text: `${qty != null ? `${num(Number(qty))} × ` : ''}${product ? linkTitle(product) : 'item'}${price != null ? ` at ${money(Number(price), ctx.currency)}` : ''}`,
      total: total != null ? money(Number(total), ctx.currency) : null,
    };
  });
  const total =
    operation === 'insert' && first.values.total != null && first.lines.length
      ? money(Number(first.values.total), ctx.currency)
      : null;
  return {
    title:
      operation === 'insert'
        ? prepared.length > 1
          ? `${prepared.length} new ${e.label.plural.toLowerCase()}`
          : `New ${e.label.singular.toLowerCase()}`
        : `Change ${e.label.singular.toLowerCase()} ${first.title ?? ''}`.trim(),
    rows,
    items,
    total,
    creates: ctx.creates,
    assumptions: [...new Set(ctx.assumptions)],
    action: operation === 'insert' ? 'Add it' : 'Save the change',
  };
}

// --- Writing ------------------------------------------------------------------------------------

function naturalKeyOf(p: Prepared, linkText: (k: string) => string | null): string | null {
  for (const alt of p.entity.naturalKeys) {
    const parts = alt.map((k) => {
      const f = p.entity.fields.find((x) => x.key === k);
      if (!f) return null;
      if (f.type === 'reference') {
        const t = linkText(k);
        return t ? normalizeLoose(t) || null : null;
      }
      const v = p.values[k];
      if (v === null || v === undefined) return null;
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      if (f.type === 'date' || f.type === 'datetime') return v;
      if (['integer', 'decimal', 'money', 'percent'].includes(f.type)) return String(Number(v));
      return normalizeLoose(v) || null;
    });
    if (parts.every((x) => x !== null)) return parts.join('|');
  }
  return null;
}

async function insertOne(
  w: TenantWriter,
  p: Prepared,
  edits: LoggedEdit[],
  parent?: { field: string; id: string; title: string },
): Promise<{ id: string; title: string }> {
  const linkIds: Record<string, { id: string; title: string }> = {};
  for (const [k, l] of Object.entries(p.links))
    linkIds[k] = 'id' in l ? l : await insertOne(w, l.create, edits);
  if (parent) linkIds[parent.field] = { id: parent.id, title: parent.title };
  const cols: string[] = [];
  const params: unknown[] = [];
  for (const f of p.entity.fields) {
    if (f.type === 'reference') {
      const l = linkIds[f.key];
      if (!l) continue;
      const c = columnsFor(f);
      cols.push(c.fk!, c.ref!);
      params.push(l.id, l.title);
    } else if (p.values[f.key] !== undefined) {
      cols.push(f.key);
      params.push(p.values[f.key]);
    }
  }
  cols.push('_natural_key');
  params.push(naturalKeyOf(p, (k) => linkIds[k]?.title ?? null));
  const titleKey = titleFieldOf(p.entity.fields);
  const { rows } = await w.query<{ id: string }>(
    `INSERT INTO ${ident(p.entity.tableName)} (${cols.map(ident).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING "_id"::text AS id`,
    params,
  );
  const id = rows[0]!.id;
  const after = Object.fromEntries(cols.map((c, i) => [c, params[i]]));
  edits.push({
    entity: p.entity.key,
    tableName: p.entity.tableName,
    recordId: id,
    op: 'insert',
    after,
  });
  const title =
    titleKey && typeof p.values[titleKey] === 'string'
      ? p.values[titleKey]
      : `${p.entity.label.singular} #${id}`;
  for (const line of p.lines) {
    const field = line.entity.fields.find(
      (f) => f.type === 'reference' && f.references === p.entity.key,
    )!;
    await insertOne(w, line, edits, { field: field.key, id, title });
  }
  return { id, title };
}

/** "Add it" / "Save the change": checks everything again, then writes it all in one batch. */
export async function applyRecordWrite(input: {
  member: MemberWorkspace;
  userId: string;
  plan: RecordWritePlan;
}): Promise<{ batchId: string; records: { entity: string; id: string; title: string }[] }> {
  requireEditor(input.member);
  const { member } = input;
  const { prepared, card } = await prepareRecordWrite(member, input.plan);
  await ensureEditLog(member.workspace.tenantSchema);
  const batchId = crypto.randomUUID();
  const records = await withTenantWriter(
    { workspaceId: member.workspace.id, tenantSchema: member.workspace.tenantSchema },
    `records.chat ${input.plan.operation} ${input.plan.entity}`,
    async (w) => {
      const edits: LoggedEdit[] = [];
      const out: { entity: string; id: string; title: string }[] = [];
      for (const p of prepared) {
        if (input.plan.operation === 'insert') {
          const r = await insertOne(w, p, edits);
          out.push({ entity: p.entity.key, ...r });
          continue;
        }
        const set: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(p.values)) set[k] = v;
        for (const [k, l] of Object.entries(p.links)) {
          const f = p.entity.fields.find((x) => x.key === k)!;
          const c = columnsFor(f);
          const target = 'id' in l ? l : await insertOne(w, l.create, edits);
          set[c.fk!] = target.id;
          set[c.ref!] = target.title;
        }
        const cols = Object.keys(set);
        const { rows: beforeRows } = await w.query(
          `SELECT ${cols.map((c) => `${ident(c)}::text AS ${ident(c)}`).join(', ')} FROM ${ident(p.entity.tableName)} WHERE "_id" = $1::bigint AND "_deleted_at" IS NULL FOR UPDATE`,
          [p.id],
        );
        if (!beforeRows[0]) throw new RecordsError('That record was deleted in the meantime.');
        await w.query(
          `UPDATE ${ident(p.entity.tableName)} SET ${cols.map((c, i) => `${ident(c)} = $${i + 2}`).join(', ')}, "_updated_at" = now() WHERE "_id" = $1::bigint`,
          [p.id, ...cols.map((c) => set[c])],
        );
        edits.push({
          entity: p.entity.key,
          tableName: p.entity.tableName,
          recordId: p.id!,
          op: 'update',
          before: beforeRows[0],
          after: set,
        });
        out.push({ entity: p.entity.key, id: p.id!, title: p.title ?? '' });
      }
      await logEdits(
        w,
        { id: batchId, origin: 'chat', userId: input.userId, summary: card.title },
        edits,
      );
      return out;
    },
    { timezone: member.settings.timezone },
  );
  await bumpDataVersion(member.workspace.id);
  return { batchId, records };
}
