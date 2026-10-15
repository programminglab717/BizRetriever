import { isDateValue, type CleanValue } from '@bizr/ingest';
import type { PackData } from '@bizr/packs';

import type { Facts } from '../narration';
import type { DryRunProblem } from './dry-run';
import type { ProfiledSource } from './heuristic';
import type { EntitySpec, MaterializeResult } from './materialize';
import type { ModelProposal } from './proposal';

/**
 * Everything the "Here's what we found" screen shows, computed by code from the dry run (so every
 * count is real). Stored as JSON with each proposal version.
 */
export interface ProposalReview {
  summary: { template: string; origin: 'ai' | 'template'; facts: Facts };
  entities: {
    key: string;
    label: { singular: string; plural: string };
    count: number;
    merged: number;
    sources: { sourceId: string; fileName: string; sheet: string }[];
    /** Up to 3 example records: detail label → display text. */
    examples: { label: string; value: string; type: string }[][];
    /** "Show details": which column fills which detail. */
    mapping: {
      sourceId: string;
      fields: {
        field: string;
        label: string;
        from: string;
        confidence: number;
        /** Set when one column fills it (the review screen can then remap that column). */
        column?: number;
      }[];
    }[];
  }[];
  skipped: { reason: string; label: string; count: number; examples: SkipExample[] }[];
  ignored: { sourceId: string; fileName: string; sheet: string; reason: string }[];
  /** Plain-language warnings from the dry run. */
  warnings: string[];
  spotted: string[];
  /** Shown when the AI couldn't help (e.g. no key, over budget). */
  aiNote?: string;
}

interface SkipExample {
  fileName: string;
  sheet: string;
  row: number;
  text: string;
}

const SKIP_LABELS: Record<string, string> = {
  totals: 'Totals and subtotals',
  blank: 'Blank lines',
  note: 'Notes',
  rule: 'Lines you asked us to skip',
  title: 'Titles',
  section: 'Section headings',
  header: 'Repeated headings',
};
const SHOWN_SKIPS = ['totals', 'note', 'rule', 'blank'];

function display(v: CleanValue): string {
  if (v === null) return '';
  if (isDateValue(v)) return v.time ? `${v.date} ${v.time.slice(0, 5)}` : v.date;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

function describeSource(
  proposal: ModelProposal,
  sourceId: string,
  entity: string,
  sources: readonly ProfiledSource[],
  spec: EntitySpec,
) {
  const src = proposal.sources.find((s) => s.sourceId === sourceId);
  const profile = sources.find((s) => s.sourceId === sourceId)?.profile;
  const fields = (src?.targets ?? [])
    .filter((t) => t.entity === entity)
    .flatMap((t) => t.fields)
    .map((m) => {
      const label = spec.fields.find((f) => f.key === m.field)?.label ?? m.field;
      const header = (ref: number | string) =>
        typeof ref === 'number'
          ? `“${profile?.columns[ref]?.header || `Column ${ref + 1}`}”`
          : ref === 'section'
            ? 'the heading above'
            : ref === 'sheet_name'
              ? 'the sheet name'
              : ref === 'unpivot_key'
                ? 'the month heading'
                : 'the amount under each month';
      const s = m.source;
      const from =
        s.kind === 'column'
          ? header(s.column)
          : s.kind === 'first_of'
            ? s.columns.map(header).join(' or ')
            : s.kind === 'constant'
              ? `always “${s.value}”`
              : s.kind === 'sequence'
                ? 'counted within each order'
                : 'worked out from other details';
      return {
        field: m.field,
        label,
        from,
        confidence: m.confidence,
        ...(s.kind === 'column' && typeof s.column === 'number' ? { column: s.column } : {}),
      };
    });
  return { sourceId, fields };
}

export function userWarnings(
  problems: readonly DryRunProblem[],
  specs: readonly EntitySpec[],
  result: MaterializeResult,
): string[] {
  const spec = (k: string) => specs.find((s) => s.key === k);
  const sheet = (id?: string) => result.stats.sources.find((s) => s.sourceId === id)?.sheet;
  return problems.map((p) => {
    const s = spec(p.entity);
    const field = s?.fields.find((f) => f.key === p.field);
    const fieldLabel = (field?.label ?? p.field).toLowerCase();
    const plural = (s?.label.plural ?? p.entity).toLowerCase();
    const pct = Math.round((p.kind === 'unmatched' ? 1 - p.rate : p.rate) * 100);
    switch (p.kind) {
      case 'unreadable':
        return `We couldn’t read the ${fieldLabel} on ${pct}% of lines in “${sheet(p.sourceId) ?? 'a sheet'}”.`;
      case 'missing_required':
        return `${pct}% of lines in “${sheet(p.sourceId) ?? 'a sheet'}” have no ${fieldLabel}, so we can’t bring them in as ${plural}.`;
      case 'unmatched': {
        const target = specs.find((x) => x.key === field?.references)?.label.singular.toLowerCase();
        return `${pct}% of ${plural} mention a ${target ?? fieldLabel} we couldn’t find in your other files.`;
      }
    }
  });
}

export function buildReview(input: {
  result: MaterializeResult;
  proposal: ModelProposal;
  specs: readonly EntitySpec[];
  pack: PackData;
  sources: readonly ProfiledSource[];
  summary: ProposalReview['summary'];
  problems: readonly DryRunProblem[];
  spotted: string[];
  aiNote?: string;
}): ProposalReview {
  const { result, proposal, specs, sources } = input;
  const entities: ProposalReview['entities'] = [];
  for (const spec of specs) {
    const records = result.entities.get(spec.key) ?? [];
    if (records.length === 0) continue;
    const fromSources = proposal.sources.filter((s) =>
      s.targets.some((t) => t.entity === spec.key),
    );
    const shownFields = spec.fields.filter((f) => !f.pii).slice(0, 12);
    const examples = records.slice(0, 3).map((r) =>
      shownFields
        .map((f) => {
          const raw =
            f.type === 'reference' ? (r.refs[f.key] ?? '') : display(r.fields[f.key] ?? null);
          // Allowed values are codes (online_store): show them as words.
          const value =
            f.allowedValues && raw
              ? raw.charAt(0).toUpperCase() + raw.slice(1).replace(/_/g, ' ')
              : raw;
          return { label: f.label, value, type: f.type };
        })
        .filter((x) => x.value !== '')
        .slice(0, 5),
    );
    entities.push({
      key: spec.key,
      label: spec.label,
      count: records.length,
      merged: result.stats.entities[spec.key]?.merged ?? 0,
      sources: fromSources.map((s) => {
        const p = sources.find((x) => x.sourceId === s.sourceId);
        return { sourceId: s.sourceId, fileName: p?.fileName ?? '', sheet: p?.sheetName ?? '' };
      }),
      examples,
      mapping: fromSources.map((s) =>
        describeSource(proposal, s.sourceId, spec.key, sources, spec),
      ),
    });
  }

  const byReason = new Map<string, SkipExample[]>();
  for (const s of result.skipped) {
    if (!SHOWN_SKIPS.includes(s.reason)) continue;
    const list = byReason.get(s.reason) ?? [];
    list.push({
      fileName: s.fileName,
      sheet: s.sheet,
      row: s.sheetRow,
      text: s.detail.slice(0, 120),
    });
    byReason.set(s.reason, list);
  }
  const skipped = SHOWN_SKIPS.flatMap((reason) => {
    const list = byReason.get(reason);
    return list
      ? [{ reason, label: SKIP_LABELS[reason]!, count: list.length, examples: list.slice(0, 20) }]
      : [];
  });

  const ignored = proposal.sources
    .filter((s) => s.decision === 'ignore')
    .map((s) => {
      const p = sources.find((x) => x.sourceId === s.sourceId);
      return {
        sourceId: s.sourceId,
        fileName: p?.fileName ?? '',
        sheet: p?.sheetName ?? '',
        reason: s.ignoreReason ?? 'Nothing we could bring in',
      };
    });

  return {
    summary: input.summary,
    entities,
    skipped,
    ignored,
    warnings: userWarnings(input.problems, specs, result),
    spotted: input.spotted,
    ...(input.aiNote ? { aiNote: input.aiNote } : {}),
  };
}
