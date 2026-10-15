import type { PackData } from '@bizr/packs';

import type { ModelProposal, QuestionEffect, SourceMapping, WireValueRule } from './proposal';

/**
 * Deterministic edits to a proposal: answers to review questions and the review screen's controls
 * ("This is actually…", "Don't bring this in"). They're applied by code, never by the AI, and they're
 * re-applied after every AI revision so the AI can't undo them (AI_DESIGN Task B).
 */

export interface Correction {
  effect: QuestionEffect;
  /** Plain-language record of what the user chose, shown under "Things we assumed". */
  label: string;
  /** The question this answers, if any (removed from the proposal once answered). */
  questionId?: string;
}

/** Turns "option X of question Y" into a correction. Undefined if either doesn't exist. */
export function answerToCorrection(
  proposal: ModelProposal,
  questionId: string,
  optionId: string,
): Correction | undefined {
  const q = proposal.questions.find((x) => x.id === questionId);
  const o = q?.options.find((x) => x.id === optionId);
  if (!q || !o) return undefined;
  return { effect: o.effect, label: `${q.text} ${o.label}.`, questionId };
}

const DATE_TYPES = new Set(['date', 'datetime']);

function mapSource(
  proposal: ModelProposal,
  sourceId: string,
  fn: (s: SourceMapping) => SourceMapping,
): ModelProposal {
  return {
    ...proposal,
    sources: proposal.sources.map((s) => (s.sourceId === sourceId ? fn(s) : s)),
  };
}

/** Applies one effect. Effects that mention things that no longer exist change nothing. */
export function applyEffect(
  proposal: ModelProposal,
  effect: QuestionEffect,
  pack: PackData,
): ModelProposal {
  switch (effect.kind) {
    case 'none':
    case 'keep_dedupe':
      return proposal;

    case 'drop_dedupe':
      return {
        ...proposal,
        dedupe: proposal.dedupe
          .map((d) =>
            d.entity === effect.entity
              ? { ...d, clusters: d.clusters.filter((c) => c.canonical !== effect.canonical) }
              : d,
          )
          .filter((d) => d.clusters.length > 0),
      };

    case 'set_date_order': {
      const ids = new Set(effect.sourceIds);
      const isDate = (entity: string, field: string) => {
        const t = pack.entities
          .find((e) => e.id === entity)
          ?.fields.find((f) => f.id === field)?.type;
        return t !== undefined && DATE_TYPES.has(t);
      };
      return {
        ...proposal,
        sources: proposal.sources.map((s) =>
          !ids.has(s.sourceId)
            ? s
            : {
                ...s,
                targets: s.targets.map((t) => ({
                  ...t,
                  fields: t.fields.map((m) => {
                    if (!isDate(t.entity, m.field)) return m;
                    const rules: WireValueRule[] = m.rules.filter((r) => r.rule !== 'parse_date');
                    const old = m.rules.find(
                      (r): r is Extract<WireValueRule, { rule: 'parse_date' }> =>
                        r.rule === 'parse_date',
                    );
                    rules.push({ ...old, rule: 'parse_date', order: effect.order });
                    return { ...m, rules };
                  }),
                })),
              },
        ),
      };
    }

    case 'set_rules':
      return mapSource(proposal, effect.sourceId, (s) => ({
        ...s,
        targets: s.targets.map((t) =>
          t.entity !== effect.entity
            ? t
            : {
                ...t,
                fields: t.fields.map((m) =>
                  m.field === effect.field ? { ...m, rules: effect.rules } : m,
                ),
              },
        ),
      }));

    case 'ignore_source':
      return mapSource(proposal, effect.sourceId, (s) => ({
        ...s,
        decision: 'ignore',
        ignoreReason: 'You asked us not to bring this in',
        targets: [],
      }));

    case 'unmap_field':
      return mapSource(proposal, effect.sourceId, (s) => ({
        ...s,
        targets: s.targets.map((t) =>
          t.entity !== effect.entity
            ? t
            : { ...t, fields: t.fields.filter((m) => m.field !== effect.field) },
        ),
      }));

    case 'map_column':
      return mapSource(proposal, effect.sourceId, (s) => {
        // A column means one thing: take it away from any other field in this table first.
        const targets = s.targets.map((t) => ({
          ...t,
          fields: t.fields.filter(
            (m) =>
              !(m.source.kind === 'column' && m.source.column === effect.column) &&
              !(t.entity === effect.entity && m.field === effect.field),
          ),
        }));
        const mapping = {
          field: effect.field,
          source: { kind: 'column' as const, column: effect.column },
          rules: [],
          confidence: 1,
        };
        const target = targets.find((t) => t.entity === effect.entity);
        if (target) target.fields.push(mapping);
        else targets.push({ entity: effect.entity, grain: 'row', fields: [mapping] });
        return {
          ...s,
          decision: 'map',
          targets: targets.filter((t) => t.fields.length > 0),
        };
      });
  }
}

/**
 * Applies the user's corrections in order. Answered questions are removed and each correction is
 * recorded as a confident assumption, so the review screen shows what the user told us.
 */
export function applyCorrections(
  proposal: ModelProposal,
  corrections: readonly Correction[],
  pack: PackData,
): ModelProposal {
  let out = proposal;
  for (const c of corrections) out = applyEffect(out, c.effect, pack);
  const answered = new Set(corrections.flatMap((c) => (c.questionId ? [c.questionId] : [])));
  const told = corrections.map((c, i) => ({
    id: `you-${i + 1}`,
    about: 'your answer',
    text: c.label.slice(0, 300),
    confidence: 1,
  }));
  return {
    ...out,
    questions: out.questions.filter((q) => !answered.has(q.id)),
    assumptions: [...out.assumptions.filter((a) => !a.id.startsWith('you-')), ...told].slice(-30),
  };
}
