import { z } from 'zod';

import type { PackDashboard } from './dashboard';
import type { PackInsights } from './insights';
import type { PackMetrics } from './metrics';
import type { PackQuestion } from './questions';
import type { PackEntity, PackManifest } from './schema';

/**
 * A pack in another language (M20, ADR-071): `packs/<id>/i18n/<lang>.yaml`. Everything people read
 * that the pack writes (record and detail names, measures, tiles, insight sentences, example
 * questions), keyed by id, plus words owners use in that language: column headers in their files,
 * and names for measures and details when they ask questions. The English stays the source: ids,
 * rules and numbers never change by language.
 */

const text = z.string().min(1);
const words = z.array(z.string().min(1)).default([]);

const fieldTranslation = z.union([
  text,
  z.object({ label: text, description: text.optional() }).strict(),
]);

export const packTranslationSchema = z
  .object({
    manifest: z
      .object({
        name: text,
        description: text,
        industries_label: text,
        helpful_files: z.array(z.object({ what: text, detail: text }).strict()).default([]),
        goal_words: z.record(z.string(), words).default({}),
      })
      .strict(),
    entities: z.record(
      z.string(),
      z
        .object({
          singular: text,
          plural: text,
          description: text,
          fields: z.record(z.string(), fieldTranslation).default({}),
        })
        .strict(),
    ),
    metrics: z.record(
      z.string(),
      z
        .object({
          label: text,
          description: text,
          unavailable_hint: text.optional(),
          assumptions: z.array(text).default([]),
          synonyms: words,
        })
        .strict(),
    ),
    dimensions: z
      .record(
        z.string(),
        z
          .object({
            label: text,
            synonyms: words,
            noun: z.tuple([text, text]).optional(),
            value_labels: z.record(z.string(), text).default({}),
          })
          .strict(),
      )
      .default({}),
    dashboard: z.record(z.string(), text).default({}),
    insights: z.record(
      z.string(),
      z
        .object({
          label: text,
          description: text,
          thresholds: z.record(z.string(), text).default({}),
          template: text,
          context: text.optional(),
          action: z.object({ label: text, ask: text.optional() }).strict().optional(),
          /** Fallback words for text facts ("your supplier"). */
          fallbacks: z.record(z.string(), text).default({}),
          /** Words a text fact can be, translated: `direction: { up: subieron, down: bajaron }`. */
          words: z.record(z.string(), z.record(z.string(), text)).default({}),
        })
        .strict(),
    ),
    questions: z
      .array(z.object({ group: text, text, needs: z.array(z.string()).default([]) }).strict())
      .default([]),
    /** Column headers in this language, added to synonyms.yaml's `fields` for reading files. */
    headers: z.record(z.string(), words).default({}),
    /**
     * Words for coded values in this language (like synonyms.yaml's `values`): read in files and
     * understood in questions ("en la tienda" → in_store).
     */
    values: z.record(z.string(), z.record(z.string(), words)).default({}),
  })
  .strict();

export type PackTranslation = z.infer<typeof packTranslationSchema>;

const PLACEHOLDERS = /\{\{\s*([a-z_][a-z0-9_]*)\s*(?:\|[^}]*)?\}\}/g;
const names = (s: string | undefined) =>
  [...new Set([...(s ?? '').matchAll(PLACEHOLDERS)].map((m) => m[1]!))].sort().join();

/**
 * Checks a translation against its pack: every id exists, every insight sentence keeps the English
 * one's placeholders and writes no digits of its own, and (`complete`) nothing people read is left
 * untranslated.
 */
export function checkTranslation(
  t: PackTranslation,
  pack: {
    manifest: PackManifest;
    entities: PackEntity[];
    metrics: PackMetrics;
    dashboard: PackDashboard;
    insights: PackInsights;
    questions: PackQuestion[];
  },
  complete: boolean,
): string[] {
  const problems: string[] = [];
  const entities = new Map(pack.entities.map((e) => [e.id, e]));
  for (const [id, e] of Object.entries(t.entities)) {
    const def = entities.get(id);
    if (!def) {
      problems.push(`entities.${id}: no such record type`);
      continue;
    }
    for (const f of Object.keys(e.fields))
      if (!def.fields.some((x) => x.id === f))
        problems.push(`entities.${id}.fields.${f}: no such detail`);
  }
  const metrics = new Set(pack.metrics.metrics.map((m) => m.id));
  for (const id of Object.keys(t.metrics))
    if (!metrics.has(id)) problems.push(`metrics.${id}: no such measure`);
  const dims = new Set(pack.metrics.dimensions.map((d) => d.field));
  for (const id of Object.keys(t.dimensions))
    if (!dims.has(id)) problems.push(`dimensions.${id}: no such detail`);
  const tiles = new Set(pack.dashboard.tiles.map((x) => x.id));
  for (const id of Object.keys(t.dashboard))
    if (!tiles.has(id)) problems.push(`dashboard.${id}: no such tile`);
  const rules = new Map(pack.insights.rules.map((r) => [r.id, r]));
  for (const [id, r] of Object.entries(t.insights)) {
    const def = rules.get(id);
    if (!def) {
      problems.push(`insights.${id}: no such rule`);
      continue;
    }
    for (const [what, en, es] of [
      ['template', def.template, r.template],
      ['context', def.context, r.context],
    ] as const) {
      if (names(en) !== names(es))
        problems.push(`insights.${id}.${what}: placeholders must match the English (${names(en)})`);
      if (/\d/.test((es ?? '').replace(/\{\{[^}]*\}\}/g, '')))
        problems.push(`insights.${id}.${what}: numbers must come from facts`);
    }
    if (Boolean(def.context) !== Boolean(r.context))
      problems.push(`insights.${id}.context: translate it exactly when the English has one`);
    for (const [th, label] of Object.entries(r.thresholds)) {
      const en = def.thresholds[th];
      if (!en) problems.push(`insights.${id}.thresholds.${th}: no such threshold`);
      else if (en.label.includes('{{value}}') !== label.includes('{{value}}'))
        problems.push(`insights.${id}.thresholds.${th}: keep {{value}}`);
    }
    if (Boolean(def.action) !== Boolean(r.action))
      problems.push(`insights.${id}.action: translate it exactly when the English has one`);
    else if (def.action && 'ask' in def.action && !r.action?.ask)
      problems.push(`insights.${id}.action.ask: the question needs translating too`);
    for (const f of Object.keys(r.fallbacks))
      if (!def.facts[f]) problems.push(`insights.${id}.fallbacks.${f}: no such fact`);
    for (const [f, words] of Object.entries(r.words)) {
      const fact = def.facts[f];
      if (!fact) problems.push(`insights.${id}.words.${f}: no such fact`);
      else if ('choose' in fact)
        for (const w of [fact.then, fact.else])
          if (!words[w]) problems.push(`insights.${id}.words.${f}.${w}: missing`);
    }
  }
  for (const q of t.questions)
    for (const m of q.needs)
      if (!metrics.has(m)) problems.push(`questions: unknown measure "${m}"`);
  if (t.manifest.helpful_files.length !== pack.manifest.helpful_files.length)
    problems.push('manifest.helpful_files: translate each one, in the same order');

  if (complete) {
    for (const e of pack.entities) {
      const te = t.entities[e.id];
      if (!te) problems.push(`entities.${e.id}: missing`);
      else
        for (const f of e.fields)
          if (!te.fields[f.id]) problems.push(`entities.${e.id}.fields.${f.id}: missing`);
    }
    for (const m of pack.metrics.metrics) {
      const tm = t.metrics[m.id];
      if (!tm) problems.push(`metrics.${m.id}: missing`);
      else {
        if (m.unavailable_hint && !tm.unavailable_hint)
          problems.push(`metrics.${m.id}.unavailable_hint: missing`);
        if (m.assumptions.length !== tm.assumptions.length)
          problems.push(`metrics.${m.id}.assumptions: translate each one, in the same order`);
      }
    }
    for (const d of pack.metrics.dimensions) {
      const td = t.dimensions[d.field];
      if (!td) problems.push(`dimensions.${d.field}: missing`);
      else {
        if (d.noun && !td.noun) problems.push(`dimensions.${d.field}.noun: missing`);
        for (const v of Object.keys(d.value_labels))
          if (!td.value_labels[v])
            problems.push(`dimensions.${d.field}.value_labels.${v}: missing`);
      }
    }
    for (const x of pack.dashboard.tiles)
      if (!t.dashboard[x.id]) problems.push(`dashboard.${x.id}: missing`);
    for (const r of pack.insights.rules) {
      const tr = t.insights[r.id];
      if (!tr) problems.push(`insights.${r.id}: missing`);
      else {
        for (const th of Object.keys(r.thresholds))
          if (!tr.thresholds[th]) problems.push(`insights.${r.id}.thresholds.${th}: missing`);
        for (const [f, def] of Object.entries(r.facts)) {
          if ('fallback' in def && def.fallback && !tr.fallbacks[f])
            problems.push(`insights.${r.id}.fallbacks.${f}: missing`);
          if ('choose' in def && !tr.words[f])
            problems.push(
              `insights.${r.id}.words.${f}: missing (the words “${def.then}” and “${def.else}”)`,
            );
        }
      }
    }
    if (pack.questions.length > 0 && t.questions.length === 0) problems.push('questions: missing');
  }
  return problems;
}
