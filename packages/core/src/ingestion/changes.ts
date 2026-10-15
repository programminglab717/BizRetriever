import type { PackData } from '@bizr/packs';

import type { ProfiledSource } from './heuristic';
import type { FieldMapping, ModelProposal } from './proposal';

/**
 * A deterministic "What changed" list between two proposals, in plain language. Used when the AI's
 * own change summary is missing or fails the copy checks.
 */
export function describeChanges(
  before: ModelProposal,
  after: ModelProposal,
  sources: readonly ProfiledSource[],
  pack: PackData,
): string[] {
  const out: string[] = [];
  const name = (id: string) => {
    const s = sources.find((x) => x.sourceId === id);
    return s ? `“${s.sheetName}”` : 'one of your sheets';
  };
  const header = (sourceId: string, m: FieldMapping) => {
    const s = m.source;
    if (s.kind !== 'column' || typeof s.column !== 'number') return undefined;
    return sources.find((x) => x.sourceId === sourceId)?.profile.columns[s.column]?.header;
  };
  const entityLabel = (id: string) =>
    pack.entities.find((e) => e.id === id)?.label.plural.toLowerCase() ?? id;
  const fieldLabel = (e: string, f: string) =>
    pack.entities
      .find((x) => x.id === e)
      ?.fields.find((x) => x.id === f)
      ?.label.toLowerCase() ?? f;

  for (const a of after.sources) {
    const b = before.sources.find((x) => x.sourceId === a.sourceId);
    if (!b) continue;
    if (b.decision !== a.decision) {
      out.push(
        a.decision === 'ignore'
          ? `We’ll skip ${name(a.sourceId)}.`
          : `We’ll now bring in ${name(a.sourceId)}.`,
      );
      continue;
    }
    for (const t of a.targets) {
      const bt = b.targets.find((x) => x.entity === t.entity);
      if (!bt) {
        out.push(`${name(a.sourceId)} now gives ${entityLabel(t.entity)}.`);
        continue;
      }
      for (const m of t.fields) {
        const bm = bt.fields.find((x) => x.field === m.field);
        const h = header(a.sourceId, m);
        if (!bm) {
          out.push(
            h
              ? `In ${name(a.sourceId)}, “${h}” is now the ${fieldLabel(t.entity, m.field)}.`
              : `In ${name(a.sourceId)}, we now fill in the ${fieldLabel(t.entity, m.field)}.`,
          );
        } else if (JSON.stringify(bm) !== JSON.stringify(m)) {
          out.push(
            `In ${name(a.sourceId)}, we changed how we read the ${fieldLabel(t.entity, m.field)}.`,
          );
        }
      }
      for (const bm of bt.fields) {
        if (!t.fields.some((x) => x.field === bm.field))
          out.push(
            `In ${name(a.sourceId)}, we no longer fill in the ${fieldLabel(t.entity, bm.field)}.`,
          );
      }
    }
    for (const bt of b.targets) {
      if (!a.targets.some((x) => x.entity === bt.entity))
        out.push(`${name(a.sourceId)} no longer gives ${entityLabel(bt.entity)}.`);
    }
  }
  const clusters = (p: ModelProposal) => p.dedupe.reduce((n, d) => n + d.clusters.length, 0);
  if (clusters(after) < clusters(before)) out.push('We’ll keep some similar names apart.');
  if (clusters(after) > clusters(before)) out.push('We’ll merge more similar names.');
  return out.slice(0, 12);
}
