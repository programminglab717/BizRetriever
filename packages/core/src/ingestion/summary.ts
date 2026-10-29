import { AiError, type LLMProvider } from '@bizr/ai';
import { summarizeProposal as summaryPromptEn, summarizeProposalEs } from '@bizr/ai/prompts';
import type { Language } from '@bizr/i18n';
import type { PackData } from '@bizr/packs';
import { getLogger } from '@bizr/platform';
import { z } from 'zod';

import { MAX_TEMPLATE_LENGTH, validateTemplate, type Facts } from '../narration';
import type { MaterializeResult } from './materialize';
import type { ModelProposal } from './proposal';

/**
 * AI Task C: the "Here's what we found" summary. The AI writes a template with placeholders only;
 * code fills in every number (ADR-009). A deterministic template is used whenever the AI is
 * unavailable or its text fails the checks.
 */

/** Record types in the order an owner cares about them. */
const ORDER = ['product', 'sale', 'customer', 'supplier', 'purchase', 'return', 'expense'];
const SKIP_REASONS = new Set(['totals', 'blank', 'note', 'rule']);

export interface SummaryFacts {
  facts: Facts;
  /** For the AI: what each placeholder means. */
  meanings: { name: string; meaning: string }[];
}

export function proposalFacts(
  result: MaterializeResult,
  proposal: ModelProposal,
  pack: PackData,
  fileCount: number,
  /** The words counts come with, in the business's language (M20). */
  lang: Language = 'en',
): SummaryFacts {
  const es = lang === 'es';
  const tr = es ? pack.translations.es : undefined;
  const word = (en: [string, string], sp: [string, string]) => (es ? sp : en);
  const facts: Facts = {};
  const meanings: SummaryFacts['meanings'] = [];
  const add = (name: string, meaning: string, value: number, one: string, other: string) => {
    facts[name] = { kind: 'count', value, one, other };
    meanings.push({ name, meaning });
  };

  const entities = [...pack.entities].sort((a, b) => {
    const ia = ORDER.indexOf(a.id);
    const ib = ORDER.indexOf(b.id);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  for (const e of entities) {
    const n = result.entities.get(e.id)?.length ?? 0;
    if (n === 0) continue;
    add(
      `${e.id}_count`,
      `number of ${e.label.plural.toLowerCase()}, with the word`,
      n,
      (tr?.entities[e.id]?.singular ?? e.label.singular).toLowerCase(),
      (tr?.entities[e.id]?.plural ?? e.label.plural).toLowerCase(),
    );
  }
  const channels = new Set(
    (result.entities.get('sale') ?? []).flatMap((r) => {
      const c = r.fields.channel;
      return typeof c === 'string' && c ? [c] : [];
    }),
  );
  if (channels.size > 1)
    add(
      'channel_count',
      'number of places they sell, with the word',
      channels.size,
      ...word(['channel', 'channels'], ['canal', 'canales']),
    );
  const skipped = result.skipped.filter((s) => SKIP_REASONS.has(s.reason)).length;
  if (skipped > 0)
    add(
      'skipped_count',
      'number of lines we’ll skip because they are totals, notes or blank, with the word',
      skipped,
      ...word(['line', 'lines'], ['línea', 'líneas']),
    );
  add(
    'file_count',
    'number of files uploaded, with the word',
    fileCount,
    ...word(['file', 'files'], ['archivo', 'archivos']),
  );
  if (proposal.questions.length > 0)
    add(
      'question_count',
      'number of things the owner should check, with the word',
      proposal.questions.length,
      ...word(['thing', 'things'], ['cosa', 'cosas']),
    );
  return { facts, meanings };
}

const joinList = (items: string[], and = 'and') =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`;

/** The fallback template. Always valid for the facts it was built from. */
export function deterministicSummary(facts: Facts, lang: Language = 'en'): string {
  if (lang === 'es') return deterministicSummaryEs(facts);
  const found = ORDER.map((e) => `${e}_count`)
    .filter((k) => facts[k])
    .slice(0, 4)
    .map((k) => `{{${k}}}`);
  const parts: string[] = [];
  if (found.length > 0) {
    const where = facts.channel_count ? ' across {{channel_count}}' : '';
    parts.push(`We found ${joinList(found)}${where} in your {{file_count}}.`);
  } else {
    parts.push(
      'We looked through your {{file_count}} but didn’t find records we could bring in yet.',
    );
  }
  if (facts.skipped_count)
    parts.push('We’ll skip {{skipped_count}} that look like totals, notes or blanks.');
  if (facts.question_count) parts.push('Please check {{question_count}} below.');
  return parts.join(' ');
}

function deterministicSummaryEs(facts: Facts): string {
  const found = ORDER.map((e) => `${e}_count`)
    .filter((k) => facts[k])
    .slice(0, 4)
    .map((k) => `{{${k}}}`);
  const parts: string[] = [];
  if (found.length > 0) {
    const where = facts.channel_count ? ' en {{channel_count}}' : '';
    parts.push(`Encontramos ${joinList(found, 'y')}${where} en tus {{file_count}}.`);
  } else {
    parts.push(
      'Revisamos tus {{file_count}}, pero todavía no encontramos registros que podamos traer.',
    );
  }
  if (facts.skipped_count)
    parts.push('Omitiremos {{skipped_count}} que parecen totales, notas o filas vacías.');
  if (facts.question_count) parts.push('Revisa {{question_count}} más abajo.');
  return parts.join(' ');
}

const outputSchema = z.object({ template: z.string().max(MAX_TEMPLATE_LENGTH) }).strict();

export async function summarizeProposal(
  summary: SummaryFacts,
  proposal: ModelProposal,
  ctx: {
    provider: LLMProvider;
    workspaceId?: string | null;
    aiMode?: 'auto' | 'always' | 'never';
    /** The business's language (M20): the review is read by whoever opens it. */
    lang?: Language;
  },
): Promise<{ template: string; origin: 'ai' | 'template' }> {
  const summaryPrompt = ctx.lang === 'es' ? summarizeProposalEs : summaryPromptEn;
  const fallback = deterministicSummary(summary.facts, ctx.lang);
  if (ctx.aiMode === 'never') return { template: fallback, origin: 'template' };
  try {
    const prompt = summaryPrompt.build({
      facts: summary.meanings,
      assumptions: proposal.assumptions.slice(0, 8).map((a) => a.text),
      questionsToAnswer: proposal.questions.length > 0,
    });
    const res = await ctx.provider.generate({
      task: summaryPrompt.task,
      promptVersion: summaryPrompt.version,
      tier: 'fast',
      effort: 'low',
      system: summaryPrompt.system,
      ...prompt,
      schema: outputSchema,
      maxTokens: 1_000,
      workspaceId: ctx.workspaceId ?? null,
    });
    const problems = validateTemplate(res.data.template, Object.keys(summary.facts));
    if (problems.length > 0) {
      getLogger('ingest.ai').warn({ problems }, 'summary template rejected; using fallback');
      return { template: fallback, origin: 'template' };
    }
    return { template: res.data.template.trim(), origin: 'ai' };
  } catch (err) {
    if (err instanceof AiError) return { template: fallback, origin: 'template' };
    throw err;
  }
}
