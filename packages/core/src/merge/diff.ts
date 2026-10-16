/**
 * The merge engine (ARCHITECTURE §9, ADR-043): what a re-uploaded file would change, and the writes
 * that make it so. Pure and deterministic. It never proposes deleting anything: records missing from
 * the new file are only listed. A blank cell never overwrites a value. Fields the owner changed in
 * the app since the last import become conflicts for them to settle.
 */

export type MergeFieldType =
  | 'text'
  | 'integer'
  | 'decimal'
  | 'money'
  | 'percent'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'reference';

export interface MergeField {
  key: string;
  type: MergeFieldType;
}

export interface ExistingRecord {
  id: string;
  naturalKey: string | null;
  rowHash: string | null;
  /** Field key → value as stored (reference fields: the original text). */
  values: Record<string, unknown>;
  /** Fields changed in the app since this record was last imported. */
  editedFields: ReadonlySet<string>;
  /** Came from the same source as the new file (only those can be "missing"). */
  inScope: boolean;
}

export interface IncomingRecord {
  naturalKey: string | null;
  rowHash: string;
  values: Record<string, unknown>;
  /** Anything else the caller needs back when inserting (links, lineage). */
  payload?: unknown;
}

export interface FieldChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface MergeDiff {
  /** New records, with their position in the incoming list. */
  new: (IncomingRecord & { index: number; unkeyed?: boolean })[];
  /** Incoming position → the existing record it is (changed, unchanged or in conflict). */
  matches: Map<number, string>;
  changed: { id: string; naturalKey: string | null; fields: FieldChange[] }[];
  unchanged: number;
  /** In the old data (same source) but not in the new file. Kept; listed for the owner. */
  missing: ExistingRecord[];
  conflicts: {
    id: string;
    naturalKey: string | null;
    field: string;
    mine: string | null;
    theirs: string | null;
  }[];
  /** Keys that appear more than once in the new file (the first one is used). */
  duplicates: { naturalKey: string; count: number }[];
}

/** Plain text for a scalar from a row or a cell; anything else as JSON. */
export function asText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return v.toString();
  return JSON.stringify(v) ?? '';
}

/** One spelling per meaning, so "12.50", 12.5 and "12.5000" compare equal. Blank is null. */
export function canonical(type: MergeFieldType, v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    const day = `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
    return type === 'datetime' ? v.toISOString() : day;
  }
  if (typeof v === 'object') return JSON.stringify(v);
  const s = asText(v).trim();
  if (s === '') return null;
  switch (type) {
    case 'integer':
    case 'decimal':
    case 'money':
    case 'percent': {
      if (!/^-?\d+(\.\d+)?$/.test(s)) return s;
      const [int, frac = ''] = s.split('.');
      const f = frac.replace(/0+$/, '');
      const i = String(BigInt(int!));
      return f ? `${i}.${f}` : i === '-0' ? '0' : i;
    }
    case 'boolean':
      return ['true', 't', '1', 'yes'].includes(s.toLowerCase()) ? 'true' : 'false';
    case 'date':
      return s.slice(0, 10);
    case 'datetime': {
      // The same instant, however it's written; without an offset it can't be placed, so as is.
      const t = hasOffset(s) ? Date.parse(s) : NaN;
      return Number.isNaN(t) ? s : new Date(t).toISOString();
    }
    default:
      return s;
  }
}

/** "…T10:15:33-04:00", "…+0530", "…Z": a date-time that names its offset. */
export function hasOffset(s: string): boolean {
  return /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/i.test(s.trim());
}

export function diffRecords(
  fields: readonly MergeField[],
  existing: readonly ExistingRecord[],
  incoming: readonly IncomingRecord[],
): MergeDiff {
  const byKey = new Map<string, ExistingRecord>();
  const byHash = new Map<string, ExistingRecord>();
  for (const e of existing) {
    if (e.naturalKey) byKey.set(e.naturalKey, e);
    else if (e.rowHash) byHash.set(e.rowHash, e);
  }
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  const diff: MergeDiff = {
    new: [],
    matches: new Map(),
    changed: [],
    unchanged: 0,
    missing: [],
    conflicts: [],
    duplicates: [],
  };

  for (const [index, r] of incoming.entries()) {
    if (r.naturalKey) {
      counts.set(r.naturalKey, (counts.get(r.naturalKey) ?? 0) + 1);
      if ((counts.get(r.naturalKey) ?? 0) > 1) continue;
      const e = byKey.get(r.naturalKey);
      if (!e) {
        diff.new.push({ ...r, index });
        continue;
      }
      seen.add(e.id);
      diff.matches.set(index, e.id);
      const changes: FieldChange[] = [];
      for (const f of fields) {
        const to = canonical(f.type, r.values[f.key]);
        if (to === null) continue; // a blank cell never overwrites
        const from = canonical(f.type, e.values[f.key]);
        if (from === to) continue;
        if (e.editedFields.has(f.key))
          diff.conflicts.push({
            id: e.id,
            naturalKey: e.naturalKey,
            field: f.key,
            mine: from,
            theirs: to,
          });
        else changes.push({ field: f.key, from, to });
      }
      if (changes.length)
        diff.changed.push({ id: e.id, naturalKey: e.naturalKey, fields: changes });
      else if (!diff.conflicts.some((c) => c.id === e.id)) diff.unchanged++;
    } else {
      // No key: the same content is the same record; anything else is new, for the owner to review.
      const e = byHash.get(r.rowHash);
      if (e && !seen.has(e.id)) {
        seen.add(e.id);
        diff.matches.set(index, e.id);
        diff.unchanged++;
      } else diff.new.push({ ...r, index, unkeyed: true });
    }
  }
  diff.missing = existing.filter((e) => e.inScope && !seen.has(e.id));
  diff.duplicates = [...counts]
    .filter(([, n]) => n > 1)
    .map(([naturalKey, count]) => ({ naturalKey, count }));
  return diff;
}

/** Conflict choices, keyed `<record id>:<field>`. Unchosen conflicts keep the owner's value. */
export type Resolutions = Record<string, 'mine' | 'theirs'>;

export interface MergeWrites {
  inserts: (IncomingRecord & { index: number })[];
  /** Field values to set (canonical strings) and what they were, for undo. */
  updates: {
    id: string;
    set: Record<string, string | null>;
    before: Record<string, string | null>;
  }[];
}

/** The writes for a diff. Only inserts and updates: there is no delete. */
export function mergeWrites(diff: MergeDiff, resolutions: Resolutions): MergeWrites {
  const updates = new Map<string, MergeWrites['updates'][number]>();
  const entry = (id: string) => {
    let u = updates.get(id);
    if (!u) updates.set(id, (u = { id, set: {}, before: {} }));
    return u;
  };
  for (const c of diff.changed)
    for (const f of c.fields) {
      const u = entry(c.id);
      u.set[f.field] = f.to;
      u.before[f.field] = f.from;
    }
  for (const c of diff.conflicts)
    if (resolutions[`${c.id}:${c.field}`] === 'theirs') {
      const u = entry(c.id);
      u.set[c.field] = c.theirs;
      u.before[c.field] = c.mine;
    }
  return { inserts: diff.new, updates: [...updates.values()] };
}
