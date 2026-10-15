import { AiError, type LLMProvider } from '@bizr/ai';
import {
  proposeDataModel as proposePrompt,
  reviseDataModel as revisePrompt,
  type WorkspaceSettings,
} from '@bizr/ai/prompts';
import type { PackData } from '@bizr/packs';
import { getLogger } from '@bizr/platform';
import { z } from 'zod';

import { findJargon } from '../narration';
import { packCatalog, tablesForAi } from './ai-input';
import { describeChanges } from './changes';
import { applyCorrections, type Correction } from './corrections';
import { dryRunProblems, type DryRunProblem } from './dry-run';
import { proposeHeuristically, type ProfiledSource } from './heuristic';
import type { MaterializeResult } from './materialize';
import { proposalSchema, type ModelProposal } from './proposal';
import {
  dropIncompleteTargets,
  validateProposal,
  type ProposalProblem,
  type ValidationResult,
} from './validate';

/**
 * AI Tasks A and B (AI_DESIGN §4): propose and revise the data model. The deterministic proposer
 * always runs first, so ingestion works with no AI at all (no key, over budget, replay miss). The AI
 * refines its draft; its output is validated and repaired once, and if it's still invalid we keep
 * the deterministic proposal.
 */

export interface ProposalContext {
  pack: PackData;
  settings: WorkspaceSettings;
  provider: LLMProvider;
  workspaceId?: string | null;
  /**
   * `auto` (default) calls the AI only when the deterministic proposal leaves something unmapped or
   * uncertain. `always` / `never` force it (evals, tests, the "AI off" switch).
   */
  aiMode?: 'auto' | 'always' | 'never';
}

export type ProposalOrigin = 'ai' | 'heuristic';

export interface ProposalOutcome {
  proposal: ModelProposal;
  origin: ProposalOrigin;
  spotted: string[];
  warnings: ProposalProblem[];
  /** Why the AI wasn't used, or what went wrong with it (for logs; `userNote` is safe to show). */
  note?: string;
  userNote?: string;
}

const MAX_TOKENS_PROPOSE = 32_000;
const log = () => getLogger('ingest.ai');

/** Problems with the text the owner will read (AI output only; our own copy is tested). */
function copyProblems(p: ModelProposal): ProposalProblem[] {
  const out: ProposalProblem[] = [];
  const check = (path: string, text: string) => {
    const words = findJargon(text);
    if (words.length) out.push({ path, message: `uses technical words (${words.join(', ')})` });
  };
  p.assumptions.forEach((a, i) => check(`assumptions[${i}]`, a.text));
  p.questions.forEach((q, i) => {
    check(`questions[${i}]`, q.text);
    q.options.forEach((o, oi) => check(`questions[${i}].options[${oi}]`, o.label));
  });
  p.sources.forEach((s, i) => {
    if (s.ignoreReason) check(`sources[${i}].ignoreReason`, s.ignoreReason);
  });
  return out;
}

const formatProblems = (problems: readonly ProposalProblem[]) =>
  problems.map((p) => `${p.path}: ${p.message}`);

function check(proposal: ModelProposal, sources: readonly ProfiledSource[], pack: PackData) {
  const cleaned = dropIncompleteTargets(proposal, pack);
  const v = validateProposal(cleaned, { sources, pack });
  return { proposal: cleaned, v, copy: copyProblems(cleaned) };
}

/** True when the deterministic proposal is complete enough that the AI isn't needed. */
function heuristicIsEnough(proposal: ModelProposal, v: ValidationResult): boolean {
  if (v.errors.length > 0 || v.warnings.length > 0) return false;
  return proposal.sources.every(
    (s) =>
      s.decision === 'map' && s.targets.every((t) => t.fields.every((f) => f.confidence >= 0.6)),
  );
}

export async function proposeDataModel(
  sources: readonly ProfiledSource[],
  ctx: ProposalContext,
): Promise<ProposalOutcome> {
  const { pack, settings } = ctx;
  const heuristic = proposeHeuristically(sources, {
    pack,
    dateOrder: settings.dateOrder,
    today: settings.today,
  });
  const base = check(heuristic.proposal, sources, pack);
  const fallback = (note: string, userNote?: string): ProposalOutcome => ({
    proposal: base.proposal,
    origin: 'heuristic',
    spotted: heuristic.spotted,
    warnings: base.v.warnings,
    note,
    ...(userNote ? { userNote } : {}),
  });

  const mode = ctx.aiMode ?? 'auto';
  if (mode === 'never') return fallback('AI switched off');
  if (mode === 'auto' && heuristicIsEnough(base.proposal, base.v))
    return fallback('recognised every table without AI');

  const tables = tablesForAi(sources);
  const common = {
    primer: pack.primer,
    catalog: packCatalog(pack),
    settings,
  };
  try {
    const prompt = proposePrompt.build({ ...common, tables, draft: base.proposal });
    const first = await ctx.provider.generate({
      task: proposePrompt.task,
      promptVersion: proposePrompt.version,
      tier: 'strong',
      effort: 'high',
      system: proposePrompt.system,
      ...prompt,
      schema: proposalSchema,
      maxTokens: MAX_TOKENS_PROPOSE,
      workspaceId: ctx.workspaceId ?? null,
    });
    let result = check(first.data, sources, pack);

    // One repair round with the validator's findings (AI_DESIGN §3.1: retry once on validation).
    const problems = [...result.v.errors, ...result.copy];
    if (problems.length > 0) {
      log().info({ problems: problems.length }, 'repairing AI proposal');
      const repaired = await callRevise(ctx, sources, {
        proposal: result.proposal,
        problems: formatProblems(problems),
        corrections: [],
      });
      result = check(repaired.proposal, sources, pack);
    }
    if (result.v.errors.length > 0) {
      log().warn({ errors: result.v.errors.slice(0, 10) }, 'AI proposal invalid; using rules');
      return fallback('AI proposal failed validation');
    }
    return {
      proposal: result.proposal,
      origin: 'ai',
      spotted: heuristic.spotted,
      warnings: [...result.v.warnings, ...result.copy],
    };
  } catch (err) {
    if (err instanceof AiError) return fallback(err.message, err.userMessage);
    throw err;
  }
}

const reviseOutputSchema = z
  .object({
    proposal: proposalSchema,
    changeSummary: z.array(z.string().max(200)).max(12),
  })
  .strict();

async function callRevise(
  ctx: ProposalContext,
  sources: readonly ProfiledSource[],
  input: {
    proposal: ModelProposal;
    problems: string[];
    ownerRequest?: string;
    corrections: readonly Correction[];
  },
) {
  const prompt = revisePrompt.build({
    primer: ctx.pack.primer,
    catalog: packCatalog(ctx.pack),
    settings: ctx.settings,
    tables: tablesForAi(sources),
    proposal: input.proposal,
    problems: input.problems,
    ...(input.ownerRequest ? { ownerRequest: input.ownerRequest } : {}),
    locked: input.corrections.map((c) => c.label),
  });
  const res = await ctx.provider.generate({
    task: revisePrompt.task,
    promptVersion: revisePrompt.version,
    tier: 'strong',
    effort: 'medium',
    system: revisePrompt.system,
    ...prompt,
    schema: reviseOutputSchema,
    maxTokens: MAX_TOKENS_PROPOSE,
    workspaceId: ctx.workspaceId ?? null,
  });
  return res.data;
}

export interface RevisionOutcome {
  proposal: ModelProposal;
  /** False when the AI couldn't help; the proposal is then unchanged (corrections still applied). */
  revised: boolean;
  /** "What changed", in plain language. */
  changes: string[];
  warnings: ProposalProblem[];
  userNote?: string;
}

/**
 * Task B. Revises a proposal from the owner's own words or from dry-run problems. The owner's
 * structured corrections are applied before and after the AI call so it can't undo them.
 */
export async function reviseDataModel(
  input: {
    proposal: ModelProposal;
    sources: readonly ProfiledSource[];
    problems?: string[];
    ownerRequest?: string;
    corrections?: readonly Correction[];
  },
  ctx: ProposalContext,
): Promise<RevisionOutcome> {
  const corrections = input.corrections ?? [];
  const before = applyCorrections(input.proposal, corrections, ctx.pack);
  const unchanged = (userNote: string): RevisionOutcome => ({
    proposal: before,
    revised: false,
    changes: [],
    warnings: [],
    userNote,
  });
  if (ctx.aiMode === 'never') return unchanged('Our AI helper is switched off.');

  try {
    const out = await callRevise(ctx, input.sources, {
      proposal: before,
      problems: input.problems ?? [],
      ...(input.ownerRequest ? { ownerRequest: input.ownerRequest } : {}),
      corrections,
    });
    const locked = applyCorrections(out.proposal, corrections, ctx.pack);
    const result = check(locked, input.sources, ctx.pack);
    if (result.v.errors.length > 0) {
      log().warn({ errors: result.v.errors.slice(0, 10) }, 'AI revision invalid; keeping proposal');
      return unchanged(
        'We couldn’t make that change automatically. Try the “Change” buttons instead.',
      );
    }
    const aiLines = out.changeSummary.filter((l) => l.trim() && findJargon(l).length === 0);
    const changes =
      aiLines.length > 0
        ? aiLines
        : describeChanges(before, result.proposal, input.sources, ctx.pack);
    return {
      proposal: result.proposal,
      revised: true,
      changes,
      warnings: [...result.v.warnings, ...result.copy],
    };
  } catch (err) {
    if (err instanceof AiError) return unchanged(err.userMessage);
    throw err;
  }
}

export interface RefinedProposal {
  proposal: ModelProposal;
  result: MaterializeResult;
  rounds: number;
  /** Problems still present after the last round (shown as warnings on the review screen). */
  problems: DryRunProblem[];
  changes: string[];
}

/**
 * Test the proposal on every line (dry run). If too much fails to read or link, ask the AI to fix
 * it, at most `maxRounds` times, keeping a revision only if it actually reduces the problems.
 */
export async function refineWithDryRun(
  proposal: ModelProposal,
  sources: readonly ProfiledSource[],
  ctx: ProposalContext,
  dryRun: (p: ModelProposal) => MaterializeResult,
  options: { corrections?: readonly Correction[]; maxRounds?: number } = {},
): Promise<RefinedProposal> {
  let current = proposal;
  let result = dryRun(current);
  let problems = dryRunProblems(result);
  const changes: string[] = [];
  let rounds = 0;
  while (problems.length > 0 && rounds < (options.maxRounds ?? 2) && ctx.aiMode !== 'never') {
    rounds += 1;
    const revision = await reviseDataModel(
      {
        proposal: current,
        sources,
        problems: problems.map((p) => p.text),
        ...(options.corrections ? { corrections: options.corrections } : {}),
      },
      ctx,
    );
    if (!revision.revised) break;
    const nextResult = dryRun(revision.proposal);
    const nextProblems = dryRunProblems(nextResult);
    if (nextProblems.length >= problems.length) break;
    current = revision.proposal;
    result = nextResult;
    problems = nextProblems;
    changes.push(...revision.changes);
  }
  return { proposal: current, result, rounds, problems, changes };
}
