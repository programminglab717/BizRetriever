import type { PackCatalog } from '@bizr/ai/prompts';
import type { ColumnProfile } from '@bizr/ingest';
import type { PackData } from '@bizr/packs';

import type { ProfiledSource } from './heuristic';

/**
 * What the AI sees: the pack catalog (trusted, from code) and compact table profiles (untrusted,
 * from the user's files: already sanitised, truncated and masked by the profiler). Never whole files.
 */

const MAX_SAMPLES = 8;
const MAX_TOP = 8;
const MAX_SAMPLE_ROWS = 10;

export function packCatalog(pack: PackData): PackCatalog {
  return {
    entities: pack.entities.map((e) => ({
      id: e.id,
      label: e.label.plural,
      description: e.description,
      naturalKeys: e.natural_keys,
      fields: e.fields.map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type,
        ...(f.required ? { required: true } : {}),
        ...(f.references ? { references: f.references } : {}),
        ...(f.allowed_values ? { allowedValues: f.allowed_values } : {}),
        ...(f.description ? { description: f.description } : {}),
      })),
    })),
    headerSynonyms: pack.synonyms.fields,
    knownFormats: pack.knownFormats.map((k) => ({ id: k.id, label: k.label, headers: k.headers })),
  };
}

const nonZero = (o: Record<string, number>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v > 0));

function columnForAi(c: ColumnProfile) {
  return {
    i: c.index,
    header: c.header,
    filled: c.filled,
    blank: c.blank,
    distinct: c.distinct,
    kinds: nonZero(c.kinds),
    ...(c.number ? { number: c.number } : {}),
    ...(c.date
      ? {
          date: {
            min: c.date.min,
            max: c.date.max,
            dayFirstOnly: c.date.dayFirstOnly,
            monthFirstOnly: c.date.monthFirstOnly,
            ...(c.date.impliedOrder ? { impliedOrder: c.date.impliedOrder } : {}),
          },
        }
      : {}),
    ...(Object.keys(c.currencies).length ? { currencies: c.currencies } : {}),
    ...(Object.keys(c.units).length ? { units: c.units } : {}),
    ...(Object.keys(c.nullSentinels).length ? { blankWords: c.nullSentinels } : {}),
    ...(c.pii ? { contactDetail: c.pii } : {}),
    top: c.topValues.slice(0, MAX_TOP).map((t) => [t.value, t.count]),
    samples: c.samples.slice(0, MAX_SAMPLES),
    ...(c.nearDuplicates.length ? { nearDuplicates: c.nearDuplicates.slice(0, 5) } : {}),
    ...(c.blankWithinGroup ? { blankWithinGroup: c.blankWithinGroup } : {}),
  };
}

export function tablesForAi(sources: readonly ProfiledSource[]) {
  return sources.map((s) => {
    const p = s.profile;
    return {
      id: s.sourceId,
      file: s.fileName,
      sheet: s.sheetName,
      lines: nonZero(p.rowCounts),
      ...(p.sections.length ? { sections: p.sections.slice(0, 20) } : {}),
      ...(p.groupKeyColumn !== undefined ? { groupKeyColumn: p.groupKeyColumn } : {}),
      ...(p.monthColumns.length ? { monthColumns: p.monthColumns } : {}),
      columns: p.columns.map(columnForAi),
      firstLines: p.sampleRows.slice(0, MAX_SAMPLE_ROWS),
    };
  });
}
