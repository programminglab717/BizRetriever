import { createHash } from 'node:crypto';

import {
  buildRecords,
  cellCurrency,
  cleanValue,
  currencyColumn,
  headerCurrency,
  evalExpr,
  isDateValue,
  normalizeKey,
  normalizeLoose,
  parseNumber,
  readColumn,
  toCurrencyCode,
  type CleanValue,
  type DateOrder,
  type Expr,
  type RawSheet,
  type Region,
  type SkippedRow,
  type SourceRecord,
  type TargetType,
} from '@bizr/ingest';

import { bestMatches, words } from '../records/lookup';
import type { FieldDef } from '../change-plan/schema';
import {
  toExpr,
  toRowRules,
  toValueRules,
  type FieldMapping,
  type ModelProposal,
  type TargetMapping,
} from './proposal';

/** One detected table from an uploaded file. */
export interface SourceTable {
  sourceId: string;
  fileName: string;
  uploadId?: string;
  sheet: RawSheet;
  region: Region;
}

/** What the materialiser needs to know about each record type. */
export interface EntitySpec {
  key: string;
  label: { singular: string; plural: string };
  fields: FieldDef[];
  naturalKeys: string[][];
}

export interface Lineage {
  sourceId: string;
  fileName: string;
  sheet: string;
  row: number;
}

export interface MaterializedRecord {
  fields: Record<string, CleanValue>;
  /** Reference fields: the text that identifies the linked record (kept even if it can't be matched). */
  refs: Record<string, string | null>;
  /** Reference fields: index of the linked record in its entity's list, when matched. */
  links: Record<string, number | null>;
  /** Reference fields fed by several columns (e.g. SKU, then name): every candidate, tried in order. */
  refAlternatives: Record<string, string[]>;
  /** Reference fields: which fields of the linked record to match on (from this record's source). */
  refMatchOn: Record<string, string[]>;
  naturalKey: string | null;
  rowHash: string;
  lineage: Lineage[];
  /**
   * Money fields in a currency other than the business's (M20): field → ISO code, as found in the
   * column header, a Currency column or the value itself. Converted before loading.
   */
  currencies?: Record<string, string>;
}

export type IssueCode = 'unreadable_value' | 'missing_required' | 'unmatched_reference';

export interface Issue {
  code: IssueCode;
  entity: string;
  field?: string;
  sourceId: string;
  fileName: string;
  sheet: string;
  row: number;
  /** Plain language, e.g. "couldn’t read “abc” as a date". */
  message: string;
}

export interface MaterializeResult {
  entities: Map<string, MaterializedRecord[]>;
  issues: Issue[];
  skipped: (SkippedRow & { sourceId: string; fileName: string; sheet: string })[];
  stats: {
    sources: {
      sourceId: string;
      fileName: string;
      sheet: string;
      rowsIn: number;
      recordsOut: Record<string, number>;
      skipped: number;
    }[];
    entities: Record<string, { records: number; merged: number; dropped: number }>;
    references: {
      entity: string;
      field: string;
      target: string;
      matched: number;
      unmatched: number;
      unmatchedExamples: string[];
      /** Linked by a close name (included in `matched`), shown in the data report. */
      closeMatches: number;
      closeExamples: { written: string; to: string }[];
    }[];
  };
}

export interface MaterializeContext {
  dateOrder: DateOrder;
  /** The business's currency; amounts found in others are marked for conversion (M20). */
  currency?: string;
}

/** The fields an expression reads. */
function exprFields(e: Expr): string[] {
  if ('field' in e) return [e.field];
  if ('args' in e) return e.args.flatMap(exprFields);
  if ('coalesce' in e) return e.coalesce.flatMap(exprFields);
  return [];
}

const keyText = (v: CleanValue): string | null => {
  if (v === null) return null;
  if (isDateValue(v)) return v.time ? `${v.date}T${v.time}` : v.date;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const k = normalizeLoose(v);
  return k === '' ? null : k;
};

function fieldValue(record: MaterializedRecord, key: string, spec: EntitySpec): string | null {
  const def = spec.fields.find((f) => f.key === key);
  if (def?.type === 'reference') {
    const ref = record.refs[key];
    return ref ? normalizeLoose(ref) || null : null;
  }
  return keyText(record.fields[key] ?? null);
}

/** Natural-key value for each alternative (null when a part is missing). */
function altKeys(record: MaterializedRecord, spec: EntitySpec): (string | null)[] {
  return spec.naturalKeys.map((alt) => {
    const parts = alt.map((k) => fieldValue(record, k, spec));
    return parts.every((p) => p !== null) ? parts.join('|') : null;
  });
}

/**
 * Two records are the same thing if, going through the natural keys in priority order, the first key
 * both of them have is equal. A key both have but that differs means "different" (e.g. two people
 * with the same name but different emails).
 */
function sameThing(a: (string | null)[], b: (string | null)[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== null && b[i] !== null) return a[i] === b[i];
  }
  return false;
}

/** "We linked “Sage Mug” to Sage Stoneware Mug", for the data report's assumptions. */
export function closeLinkNotes(result: MaterializeResult): string[] {
  return result.stats.references.flatMap((r) =>
    r.closeExamples.map(
      (x) => `We linked “${x.written}” to ${x.to}: it’s the only one with all those words.`,
    ),
  );
}

/** Text of a cleaned value, for link keys (dates as ISO). */
function refText(v: CleanValue): string | null {
  if (v === null) return null;
  if (isDateValue(v)) return v.date;
  return String(v);
}

function hashFields(
  fields: Record<string, CleanValue>,
  refs: Record<string, string | null>,
): string {
  const ordered = Object.keys(fields)
    .sort()
    .map((k) => [k, fields[k]]);
  const orderedRefs = Object.keys(refs)
    .sort()
    .map((k) => [k, refs[k]]);
  return createHash('sha256')
    .update(JSON.stringify([ordered, orderedRefs]))
    .digest('hex')
    .slice(0, 32);
}

function targetType(def: FieldDef): TargetType {
  return def.type;
}

function rawFor(mapping: FieldMapping, record: SourceRecord): unknown {
  const s = mapping.source;
  if (s.kind === 'column') return readColumn(record, s.column);
  if (s.kind === 'first_of') {
    for (const c of s.columns) {
      const v = readColumn(record, c);
      if (v !== null && !(typeof v === 'string' && v.trim() === '')) return v;
    }
    return null;
  }
  if (s.kind === 'constant') return s.value;
  return null;
}

function rowMatches(target: TargetMapping, record: SourceRecord): boolean {
  if (!target.where) return true;
  const v = readColumn(record, target.where.column);
  const text = v === null ? '' : v instanceof Date ? v.toISOString() : String(v).trim();
  switch (target.where.op) {
    case 'not_empty':
      return text !== '';
    case 'equals':
      return (target.where.values ?? []).some((x) => x.trim().toLowerCase() === text.toLowerCase());
    case 'negative':
    case 'positive': {
      const n = typeof v === 'number' ? v : parseNumber(text)?.value;
      if (n === undefined) return false;
      return target.where.op === 'negative' ? n < 0 : n > 0;
    }
  }
}

export function materialize(
  tables: readonly SourceTable[],
  proposal: ModelProposal,
  specs: readonly EntitySpec[],
  ctx: MaterializeContext,
): MaterializeResult {
  const specByKey = new Map(specs.map((s) => [s.key, s]));
  const issues: Issue[] = [];
  const skippedAll: MaterializeResult['skipped'] = [];
  const raw = new Map<string, MaterializedRecord[]>();
  const sourceStats: MaterializeResult['stats']['sources'] = [];
  const dropped: Record<string, number> = {};

  // Spelling variants → canonical, per entity (applied to keys and to links pointing at the entity).
  const aliases = new Map<string, Map<string, string>>();
  for (const d of proposal.dedupe) {
    const map = aliases.get(d.entity) ?? new Map<string, string>();
    for (const c of d.clusters) for (const v of c.variants) map.set(normalizeLoose(v), c.canonical);
    aliases.set(d.entity, map);
  }
  const canonical = (entity: string, value: string): string =>
    aliases.get(entity)?.get(normalizeLoose(value)) ??
    aliases.get(entity)?.get(normalizeKey(value)) ??
    value;

  for (const source of proposal.sources) {
    if (source.decision !== 'map') continue;
    const table = tables.find((t) => t.sourceId === source.sourceId);
    if (!table) continue;
    const { records, skipped } = buildRecords(
      table.sheet,
      table.region,
      toRowRules(source.rowRules),
    );
    for (const s of skipped)
      skippedAll.push({
        ...s,
        sourceId: table.sourceId,
        fileName: table.fileName,
        sheet: table.sheet.name,
      });
    const business = ctx.currency ?? 'USD';
    const headerOf = new Map(table.region.columns.map((c) => [c.index, c.header]));
    const currencyCol = table.region.columns.find((c) => currencyColumn(c.header))?.index;
    /** Which currency a money value is in: its header, the row's Currency column, the value. */
    const currencyOf = (m: FieldMapping, r: SourceRecord, raw: unknown): string | null => {
      const cols =
        m.source.kind === 'column'
          ? [m.source.column]
          : m.source.kind === 'first_of'
            ? m.source.columns
            : [];
      for (const c of cols) {
        const h = typeof c === 'number' ? headerOf.get(c) : undefined;
        const fromHeader = h ? headerCurrency(h, business) : null;
        if (fromHeader) return fromHeader;
      }
      if (currencyCol !== undefined) {
        const v = readColumn(r, currencyCol);
        const code = typeof v === 'string' ? toCurrencyCode(v, business) : null;
        if (code) return code;
      }
      return cellCurrency(raw, business);
    };
    const stat = {
      sourceId: table.sourceId,
      fileName: table.fileName,
      sheet: table.sheet.name,
      rowsIn: records.length,
      recordsOut: {} as Record<string, number>,
      skipped: skipped.length,
    };

    for (const target of source.targets) {
      const spec = specByKey.get(target.entity);
      if (!spec) continue;
      const rows = records.filter((r) => rowMatches(target, r));
      const out = raw.get(spec.key) ?? [];
      raw.set(spec.key, out);

      // Group rows (orders from item rows, suppliers from a supplier column, …).
      const groups: SourceRecord[][] = [];
      if (target.grain === 'group' && target.groupBy && target.groupBy.length > 0) {
        const byKey = new Map<string, SourceRecord[]>();
        for (const r of rows) {
          const parts = target.groupBy.map((c) => {
            const v = readColumn(r, c);
            return v === null ? '' : v instanceof Date ? v.toISOString() : String(v).trim();
          });
          if (parts.every((p) => p === '')) continue;
          const k = parts.join('\u0000');
          const list = byKey.get(k) ?? [];
          if (list.length === 0) groups.push(list);
          list.push(r);
          byKey.set(k, list);
        }
      } else {
        for (const r of rows) groups.push([r]);
      }

      // Sequence numbers within consecutive rows sharing a value.
      const sequenceOf = new Map<SourceRecord, Map<string, number>>();
      for (const m of target.fields) {
        if (m.source.kind !== 'sequence') continue;
        let counter = 0;
        let previous: string | null = null;
        for (const r of rows) {
          const v = readColumn(r, m.source.within);
          const t = v === null ? '' : String(v);
          counter = t === previous ? counter + 1 : 1;
          previous = t;
          const map = sequenceOf.get(r) ?? new Map<string, number>();
          map.set(m.field, counter);
          sequenceOf.set(r, map);
        }
      }

      let produced = 0;
      for (const group of groups) {
        const first = group[0]!;
        const lineage = group.map((r) => ({
          sourceId: table.sourceId,
          fileName: table.fileName,
          sheet: table.sheet.name,
          row: r.sheetRow,
        }));
        const rec: MaterializedRecord = {
          fields: {},
          refs: {},
          links: {},
          refAlternatives: {},
          refMatchOn: {},
          naturalKey: null,
          rowHash: '',
          lineage,
        };
        let rowFailed = false;

        for (const m of target.fields) {
          const def = spec.fields.find((f) => f.key === m.field);
          if (!def || m.source.kind === 'derive') continue;
          let value: CleanValue = null;
          if (m.source.kind === 'sequence') {
            value = sequenceOf.get(first)?.get(m.field) ?? null;
          } else {
            // For groups, use the first row that has a value.
            for (const r of group) {
              const raw = rawFor(m, r);
              const result = cleanValue(raw as never, toValueRules(m.rules), targetType(def), ctx);
              if (!result.ok) {
                issues.push({
                  code: 'unreadable_value',
                  entity: spec.key,
                  field: def.key,
                  sourceId: table.sourceId,
                  fileName: table.fileName,
                  sheet: table.sheet.name,
                  row: r.sheetRow,
                  message: result.reason,
                });
                break;
              }
              if (result.value !== null) {
                value = result.value;
                if (def.type === 'money') {
                  const cur = currencyOf(m, r, raw);
                  if (cur && cur !== business) (rec.currencies ??= {})[def.key] = cur;
                }
                break;
              }
            }
          }
          if (def.type === 'reference') {
            const text = refText(value);
            rec.refs[def.key] = text === null ? null : canonical(def.references!, text);
            rec.links[def.key] = null;
            if (m.matchOn) rec.refMatchOn[def.key] = m.matchOn;
            if (m.source.kind === 'first_of') {
              const alternatives: string[] = [];
              for (const c of m.source.columns) {
                const r = cleanValue(readColumn(first, c), toValueRules(m.rules), 'reference', ctx);
                const alt = r.ok ? refText(r.value) : null;
                if (alt !== null) alternatives.push(canonical(def.references!, alt));
              }
              rec.refAlternatives[def.key] = alternatives;
            }
          } else {
            rec.fields[def.key] =
              typeof value === 'string' && def.semantic === 'name'
                ? canonical(spec.key, value)
                : value;
          }
        }
        // Derived values fill gaps only.
        for (const m of target.fields) {
          if (m.source.kind !== 'derive') continue;
          if (rec.fields[m.field] === null || rec.fields[m.field] === undefined) {
            const numeric: Record<string, CleanValue> = { ...rec.fields };
            const expr = toExpr(m.source.expr);
            rec.fields[m.field] = evalExpr(expr, numeric);
            // Worked out from amounts in another currency: it is in that currency too (M20).
            const from = rec.currencies && exprFields(expr).find((f) => rec.currencies![f]);
            if (
              from &&
              spec.fields.find((f) => f.key === m.field)?.type === 'money' &&
              rec.fields[m.field] !== null
            )
              rec.currencies![m.field] = rec.currencies![from]!;
          }
        }
        // Required details.
        for (const def of spec.fields) {
          if (!def.required) continue;
          const missing =
            def.type === 'reference'
              ? !rec.refs[def.key]
              : rec.fields[def.key] === null || rec.fields[def.key] === undefined;
          if (missing && target.fields.some((m) => m.field === def.key)) {
            issues.push({
              code: 'missing_required',
              entity: spec.key,
              field: def.key,
              sourceId: table.sourceId,
              fileName: table.fileName,
              sheet: table.sheet.name,
              row: first.sheetRow,
              message: `has no ${def.label.toLowerCase()}, so we left it out`,
            });
            rowFailed = true;
          }
        }
        if (rowFailed) {
          dropped[spec.key] = (dropped[spec.key] ?? 0) + 1;
          continue;
        }
        rec.rowHash = hashFields(rec.fields, rec.refs);
        out.push(rec);
        produced += 1;
      }
      stat.recordsOut[spec.key] = (stat.recordsOut[spec.key] ?? 0) + produced;
    }
    sourceStats.push(stat);
  }

  // Merge records that are the same thing (natural keys).
  const entities = new Map<string, MaterializedRecord[]>();
  const entityStats: MaterializeResult['stats']['entities'] = {};
  for (const [key, list] of raw) {
    const spec = specByKey.get(key)!;
    const merged: MaterializedRecord[] = [];
    const keysOf: (string | null)[][] = [];
    const index = spec.naturalKeys.map(() => new Map<string, number[]>());
    let mergedCount = 0;
    for (const rec of list) {
      const keys = altKeys(rec, spec);
      let target = -1;
      const candidates = new Set<number>();
      keys.forEach((k, i) => {
        if (k !== null) for (const c of index[i]!.get(k) ?? []) candidates.add(c);
      });
      for (const c of [...candidates].sort((a, b) => a - b)) {
        if (sameThing(keys, keysOf[c]!)) {
          target = c;
          break;
        }
      }
      if (target >= 0) {
        const existing = merged[target]!;
        for (const [f, v] of Object.entries(rec.fields))
          if ((existing.fields[f] ?? null) === null && v !== null) {
            existing.fields[f] = v;
            // The value's currency comes with it (M20).
            const cur = rec.currencies?.[f];
            if (cur) (existing.currencies ??= {})[f] = cur;
          }
        for (const [f, v] of Object.entries(rec.refs)) {
          if ((existing.refs[f] ?? null) === null && v !== null) {
            existing.refs[f] = v;
            if (rec.refAlternatives[f]) existing.refAlternatives[f] = rec.refAlternatives[f]!;
            if (rec.refMatchOn[f]) existing.refMatchOn[f] = rec.refMatchOn[f]!;
          }
        }
        existing.lineage.push(...rec.lineage);
        const updated = altKeys(existing, spec);
        keysOf[target] = updated;
        updated.forEach((k, i) => {
          if (k !== null) index[i]!.set(k, [...new Set([...(index[i]!.get(k) ?? []), target])]);
        });
        mergedCount += 1;
        continue;
      }
      const position = merged.length;
      merged.push(rec);
      keysOf.push(keys);
      keys.forEach((k, i) => {
        if (k !== null) index[i]!.set(k, [...(index[i]!.get(k) ?? []), position]);
      });
    }
    for (let i = 0; i < merged.length; i++) {
      const first = keysOf[i]!.find((k) => k !== null) ?? null;
      merged[i]!.naturalKey = first;
      merged[i]!.rowHash = hashFields(merged[i]!.fields, merged[i]!.refs);
    }
    entities.set(key, merged);
    entityStats[key] = { records: merged.length, merged: mergedCount, dropped: dropped[key] ?? 0 };
  }
  for (const spec of specs)
    if (!entities.has(spec.key))
      entityStats[spec.key] = { records: 0, merged: 0, dropped: dropped[spec.key] ?? 0 };

  // Resolve links between records.
  const refStats: MaterializeResult['stats']['references'] = [];
  for (const [key, list] of entities) {
    const spec = specByKey.get(key)!;
    for (const def of spec.fields.filter((f) => f.type === 'reference')) {
      const targetSpec = specByKey.get(def.references!);
      const targetList = entities.get(def.references!) ?? [];
      if (!targetSpec) continue;
      const defaultMatchOn = targetSpec.naturalKeys.filter((k) => k.length === 1).map((k) => k[0]!);
      const lookupCache = new Map<string, Map<string, number>>();
      const lookupFor = (field: string) => {
        let map = lookupCache.get(field);
        if (!map) {
          map = new Map<string, number>();
          targetList.forEach((t, i) => {
            const v = fieldValue(t, field, targetSpec);
            if (v !== null && !map!.has(v)) map!.set(v, i);
          });
          lookupCache.set(field, map);
        }
        return map;
      };
      // A close name: every word written is in exactly one record's name ("Sage Mug" → Sage
      // Stoneware Mug, "Fig Candle Sml" → Fig Candle Small). Only for names of two words or more.
      const nameField = targetSpec.fields.find((f) => f.semantic === 'name' && !f.pii)?.key;
      let names: { id: string; title: string }[] | undefined;
      const closeMatch = (written: string): number | undefined => {
        if (!nameField || words(written).length < 2) return undefined;
        names ??= targetList.flatMap((t, i) => {
          const v = t.fields[nameField];
          return typeof v === 'string' && v.trim() ? [{ id: String(i), title: v }] : [];
        });
        const found = bestMatches(written, names, 2);
        return found.length === 1 ? Number(found[0]!.id) : undefined;
      };
      let matched = 0;
      let unmatched = 0;
      let close = 0;
      const closeExamples = new Map<string, string>();
      const examples = new Set<string>();
      for (const rec of list) {
        const ref = rec.refs[def.key];
        if (!ref) continue;
        const candidates = (
          rec.refAlternatives[def.key]?.length ? rec.refAlternatives[def.key]! : [ref]
        ).map((r) => normalizeLoose(canonical(def.references!, r)));
        const lookups = (rec.refMatchOn[def.key] ?? defaultMatchOn).map(lookupFor);
        let found: number | undefined;
        for (const k of candidates) {
          for (const map of lookups) {
            found = map.get(k);
            if (found !== undefined) break;
          }
          if (found !== undefined) break;
        }
        if (found === undefined) {
          found = closeMatch(ref);
          if (found !== undefined) {
            close += 1;
            if (closeExamples.size < 5 && !closeExamples.has(ref)) {
              const name = targetList[found]!.fields[nameField!];
              closeExamples.set(ref, typeof name === 'string' ? name : ref);
            }
          }
        }
        if (found !== undefined) {
          rec.links[def.key] = found;
          matched += 1;
        } else {
          unmatched += 1;
          if (examples.size < 5) examples.add(ref);
          const at = rec.lineage[0]!;
          issues.push({
            code: 'unmatched_reference',
            entity: key,
            field: def.key,
            sourceId: at.sourceId,
            fileName: at.fileName,
            sheet: at.sheet,
            row: at.row,
            message: `mentions ${targetSpec.label.singular.toLowerCase()} “${ref}”, which we couldn’t find`,
          });
        }
      }
      if (matched + unmatched > 0) {
        refStats.push({
          entity: key,
          field: def.key,
          target: def.references!,
          matched,
          unmatched,
          unmatchedExamples: [...examples],
          closeMatches: close,
          closeExamples: [...closeExamples].map(([written, to]) => ({ written, to })),
        });
      }
    }
  }

  return {
    entities,
    issues,
    skipped: skippedAll,
    stats: { sources: sourceStats, entities: entityStats, references: refStats },
  };
}
