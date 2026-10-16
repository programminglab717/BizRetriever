import { AiError, type LLMProvider, type ModelTier } from '@bizr/ai';
import { interpretQuestion as prompt, type AskPackCatalog } from '@bizr/ai/prompts';
import type { PackData } from '@bizr/packs';
import { getLogger } from '@bizr/platform';

import { queryableRelations } from '../change-plan/views';
import { findJargon } from '../narration';
import { compileQuery } from '../semantic/compile';
import { SemanticError } from '../semantic/graph';
import type { CompileContext, SemanticModel } from '../semantic/model';
import { validateFallbackSql } from '../sql-validator/validate';
import type { AskCatalog } from './catalog';
import {
  interpretationSchema,
  toQuerySpec,
  type Interpretation,
  type QuestionSpec,
} from './interpretation';
import { interpretWithRules, type RulesResult } from './rules';

/**
 * Works out what a question means (ADR-040). The rules interpreter goes first and answers the
 * common, clear questions for free. Anything it isn't sure about goes to the AI (standard tier), whose
 * answer code checks by compiling it; one repair round, then one try on the strong tier. If the AI
 * can't help (no key, over budget, still wrong), the rules' best guess is used with a note, or the
 * owner is asked to rephrase. Every outcome is checked the same way, whoever produced it.
 */

export interface Turn {
  question: string;
  interpretation: Interpretation;
}

export interface InterpretInput {
  question: string;
  catalog: AskCatalog;
  model: SemanticModel;
  compile: CompileContext;
  pack: PackData;
  tenantSchema: string;
  /** Earlier turns of this conversation, oldest first. */
  history?: readonly Turn[];
  provider: LLMProvider | null;
  /** `auto` uses the AI only when the rules aren't sure; `never` is the "AI off" switch. */
  aiMode?: 'auto' | 'always' | 'never';
  workspaceId?: string | null;
}

export type InterpretOrigin = 'rules' | 'ai' | 'rules_fallback' | 'none';

export interface InterpretOutcome {
  interpretation: Interpretation;
  origin: InterpretOrigin;
  aiCalls: number;
  /** For logs: why the AI wasn't used or what went wrong. */
  note?: string;
}

const MAX_TOKENS = 4_000;
const HISTORY_TURNS = 6;
const log = () => getLogger('ask.interpret');

export const UNCLEAR_MESSAGE =
  'I couldn’t work out what you meant. Try asking something like “How much did I sell last month?” or “Which products made me the most profit this year?”';

export async function interpret(input: InterpretInput): Promise<InterpretOutcome> {
  const history = input.history ?? [];
  const previous = lastSpec(history);
  const rules = interpretWithRules(input.question, input.catalog, previous);
  const ruled = rules ? await check(rules.interpretation, input) : undefined;
  const mode = input.aiMode ?? 'auto';

  if (rules && ruled && ruled.problems.length === 0 && rules.confident && mode !== 'always')
    return { interpretation: ruled.interpretation, origin: 'rules', aiCalls: 0 };

  const fallback = (note: string, aiCalls: number): InterpretOutcome => {
    if (rules && ruled && ruled.problems.length === 0)
      return {
        interpretation: withUncertainty(ruled.interpretation, rules),
        origin: 'rules_fallback',
        aiCalls,
        note,
      };
    return {
      interpretation: {
        kind: 'unanswerable',
        reason: 'unclear',
        missing: [],
        message: UNCLEAR_MESSAGE,
      },
      origin: 'none',
      aiCalls,
      note,
    };
  };

  if (mode === 'never' || !input.provider) return fallback('AI switched off', 0);

  let calls = 0;
  try {
    let last: { answer: Interpretation; problems: string[] } | undefined;
    for (const tier of ['standard', 'standard', 'strong'] as ModelTier[]) {
      calls++;
      const answer = await callAi(input, tier, history, last);
      const result = await check(answer, input);
      if (result.problems.length === 0)
        return { interpretation: result.interpretation, origin: 'ai', aiCalls: calls };
      log().info({ tier, problems: result.problems }, 'AI interpretation rejected');
      last = { answer, problems: result.problems };
    }
    return fallback('AI interpretation failed validation', calls);
  } catch (err) {
    if (err instanceof AiError) return fallback(err.message, calls);
    throw err;
  }
}

function lastSpec(history: readonly Turn[]): QuestionSpec | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i]!.interpretation;
    if (t.kind === 'query') return t.spec;
  }
  return undefined;
}

async function callAi(
  input: InterpretInput,
  tier: ModelTier,
  history: readonly Turn[],
  last?: { answer: Interpretation; problems: string[] },
): Promise<Interpretation> {
  const { catalog, pack } = input;
  const packLabel = new Map(pack.metrics.metrics.map((m) => [m.id, m.label]));
  const askCatalog: AskPackCatalog = {
    measures: pack.metrics.metrics.map((m) => ({
      id: m.id,
      label: m.label,
      description: m.description,
      format: m.format,
      snapshot: m.snapshot,
      synonyms: m.synonyms,
      ...(m.default_time ? { defaultTime: m.default_time } : {}),
    })),
    breakdowns: pack.metrics.dimensions.map((d) => ({
      field: d.field,
      label: d.label,
      synonyms: d.synonyms,
    })),
  };
  const relations = Object.fromEntries(
    [...queryableRelations(input.model.entities)].map(([name, r]) => [name, r.columns]),
  );
  const built = prompt.build({
    primer: pack.primer,
    catalog: askCatalog,
    settings: { ...catalog.calendar, currency: catalog.currency },
    unavailable: catalog.metrics
      .filter((m) => !m.available)
      .map((m) => ({ id: m.id, reason: m.reason ?? 'Not in your data yet.' })),
    data: {
      values: Object.fromEntries(catalog.dimensions.map((d) => [d.field, d.values.slice(0, 100)])),
      renamed: Object.fromEntries(
        catalog.metrics.filter((m) => m.label !== packLabel.get(m.id)).map((m) => [m.id, m.label]),
      ),
      relations,
      conversation: history.slice(-HISTORY_TURNS).map((t) => ({
        question: t.question,
        meaning: t.interpretation,
      })),
      ...(last ? { lastAnswer: last.answer, problems: last.problems } : {}),
    },
    question: input.question,
  });
  const res = await input.provider!.generate({
    task: prompt.task,
    promptVersion: prompt.version,
    tier,
    effort: tier === 'strong' ? 'medium' : 'low',
    system: prompt.system,
    ...built,
    schema: interpretationSchema,
    maxTokens: MAX_TOKENS,
    workspaceId: input.workspaceId ?? null,
  });
  return res.data;
}

// --- Checks ------------------------------------------------------------------------------------

interface Checked {
  interpretation: Interpretation;
  problems: string[];
}

const hasDigit = (s: string) => /\d/.test(s);
/** Text the owner reads: no jargon, and no numbers the model made up. */
const plainText = (s: string) => findJargon(s).length === 0 && !hasDigit(s);
const cleanAssumptions = (a: readonly string[]) => a.filter(plainText);

/**
 * Checks an interpretation against the workspace: every id exists, the spec compiles, values match
 * the owner's spelling, SQL passes the validator, and owner-facing text is plain. Measures this
 * workspace can't work out turn the answer into a "missing data" one. Never asks twice in a row.
 */
export async function check(i: Interpretation, input: InterpretInput): Promise<Checked> {
  const parsed = interpretationSchema.safeParse(i);
  if (!parsed.success) return { interpretation: i, problems: [parsed.error.message.slice(0, 500)] };
  i = parsed.data;
  switch (i.kind) {
    case 'query': {
      const missing = unavailableIn(i.spec, input.catalog);
      if (missing) return { interpretation: missing, problems: [] };
      const s = checkSpec(i.spec, input);
      return {
        interpretation: { ...i, spec: s.spec, assumptions: cleanAssumptions(i.assumptions) },
        problems: s.problems,
      };
    }
    case 'clarify': {
      const lastTurn = input.history?.at(-1)?.interpretation;
      const options = i.options.map((o) => ({ ...o, ...checkSpec(o.spec, input) }));
      const problems = options.flatMap((o, n) => o.problems.map((p) => `option ${n + 1}: ${p}`));
      for (const text of [i.question, ...i.options.map((o) => o.label)])
        if (findJargon(text).length) problems.push(`plain words only: “${text}”`);
      if (problems.length) return { interpretation: i, problems };
      const first = options[0]!;
      // Never ask twice in a row: take the first reading and say so.
      if (lastTurn?.kind === 'clarify') {
        const missing = unavailableIn(first.spec, input.catalog);
        if (missing) return { interpretation: missing, problems: [] };
        return {
          interpretation: {
            kind: 'query',
            spec: first.spec,
            assumptions: [
              `I took it to mean “${first.label.toLowerCase()}”.`,
              ...cleanAssumptions(first.assumptions),
            ].slice(0, 5),
          },
          problems: [],
        };
      }
      return {
        interpretation: {
          ...i,
          options: options.map((o) => ({
            label: o.label,
            spec: o.spec,
            assumptions: cleanAssumptions(o.assumptions),
          })),
        },
        problems: [],
      };
    }
    case 'sql': {
      const v = await validateFallbackSql(i.sql, {
        tenantSchema: input.tenantSchema,
        relations: queryableRelations(input.model.entities),
      });
      return {
        interpretation: { ...i, assumptions: cleanAssumptions(i.assumptions) },
        problems: v.ok ? [] : [`the SQL was rejected: ${v.reason}`],
      };
    }
    case 'unanswerable':
      return {
        interpretation: plainText(i.message)
          ? i
          : {
              ...i,
              message:
                i.reason === 'out_of_scope'
                  ? 'That’s outside what I can answer from your records.'
                  : i.reason === 'missing_data'
                    ? 'Your data doesn’t have what I need to answer that yet.'
                    : UNCLEAR_MESSAGE,
            },
        problems: [],
      };
  }
}

function unavailableIn(spec: QuestionSpec, catalog: AskCatalog): Interpretation | undefined {
  const ids = [...spec.metrics, ...spec.having.map((h) => h.metric)];
  const m = ids
    .map((id) => catalog.metrics.find((x) => x.id === id))
    .find((x) => x && !x.available);
  if (!m) return undefined;
  return {
    kind: 'unanswerable',
    reason: 'missing_data',
    missing: [m.label],
    message: m.reason ?? `I can’t work out ${m.label.toLowerCase()} from your data yet.`,
  };
}

function checkSpec(
  spec: QuestionSpec,
  input: InterpretInput,
): { spec: QuestionSpec; problems: string[] } {
  const problems: string[] = [];
  for (const id of spec.metrics)
    if (!input.catalog.metrics.some((m) => m.id === id)) problems.push(`unknown measure "${id}"`);
  if (spec.orderBy) {
    const by = spec.orderBy.by;
    const dim = /^d(\d)$/.exec(by);
    if (dim ? Number(dim[1]) >= spec.dimensions.length : !spec.metrics.includes(by))
      problems.push(`orderBy "${by}" must be one of the measures asked for, or d0/d1`);
  }
  // Values: use the owner's spelling; when we know every value, an unknown one is a mistake.
  const filters = spec.filters.map((f) => {
    const dim = input.catalog.dimensions.find((d) => d.field === f.field);
    if (!dim || !['eq', 'neq', 'in', 'not_in'].includes(f.op)) return f;
    const values = f.values.map((v) => {
      if (typeof v !== 'string') return v;
      const exact = dim.values.find((x) => x.toLowerCase() === v.toLowerCase());
      if (exact) return exact;
      const canonical = Object.entries(dim.valueSynonyms).find(
        ([key, words]) => key === v.toLowerCase() || words.includes(v.toLowerCase()),
      );
      if (canonical) return canonical[0];
      if (dim.values.length > 0 && dim.values.length < 200)
        problems.push(`"${v}" isn't one of the values of ${f.field}; use one from "values"`);
      return v;
    });
    return { ...f, values };
  });
  const fixed = { ...spec, filters };
  if (problems.length === 0) {
    try {
      compileQuery(input.model, toQuerySpec(fixed, input.compile), input.compile);
    } catch (err) {
      if (err instanceof SemanticError) problems.push(err.message);
      else if (err instanceof Error) problems.push(err.message.slice(0, 300));
      else throw err;
    }
  }
  return { spec: fixed, problems };
}

/** The rules' best guess, used when the AI couldn't help: say which words were left out. */
function withUncertainty(i: Interpretation, rules: RulesResult): Interpretation {
  if (i.kind !== 'query' || rules.leftover.length === 0) return i;
  const words = rules.leftover
    .slice(0, 3)
    .map((w) => `“${w}”`)
    .join(', ');
  return {
    ...i,
    assumptions: [
      ...i.assumptions,
      `I wasn’t sure what you meant by ${words}, so I left it out.`,
    ].slice(0, 5),
  };
}
