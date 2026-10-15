import type { PackData, PackEntity, PackField } from '@bizr/packs';

import type { ProfiledSource } from './heuristic';
import type {
  FieldMapping,
  ModelProposal,
  QuestionEffect,
  TargetMapping,
  WireColumnRef,
} from './proposal';

/**
 * Checks a data-model proposal against the uploaded tables and the pack (AI_DESIGN Task A,
 * "Guardrails"). The schema already guarantees the shape; this checks that every id it mentions is
 * real. Errors make a proposal unusable; warnings are shown as low-confidence hints.
 */

export interface ProposalProblem {
  path: string;
  message: string;
}

export interface ValidationResult {
  errors: ProposalProblem[];
  warnings: ProposalProblem[];
}

export interface ValidationContext {
  sources: readonly ProfiledSource[];
  pack: PackData;
}

const NUMERIC_TYPES = new Set(['integer', 'decimal', 'money', 'percent']);
const TYPE_MATCH_MIN = 0.6;

type Expr = Extract<FieldMapping['source'], { kind: 'derive' }>['expr'];

function exprFields(expr: Expr): string[] {
  const out: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as { field?: string; args?: unknown[]; coalesce?: unknown[] };
    if (typeof n.field === 'string') out.push(n.field);
    n.args?.forEach(visit);
    n.coalesce?.forEach(visit);
  };
  visit(expr);
  return out;
}

export function validateProposal(
  proposal: ModelProposal,
  ctx: ValidationContext,
): ValidationResult {
  const errors: ProposalProblem[] = [];
  const warnings: ProposalProblem[] = [];
  const error = (path: string, message: string) => errors.push({ path, message });
  const warn = (path: string, message: string) => warnings.push({ path, message });

  const profiles = new Map(ctx.sources.map((s) => [s.sourceId, s]));
  const entities = new Map(ctx.pack.entities.map((e) => [e.id, e]));
  const seenSources = new Set<string>();

  proposal.sources.forEach((src, si) => {
    const at = `sources[${si}]`;
    const profiled = profiles.get(src.sourceId);
    if (!profiled) {
      error(at, `unknown table "${src.sourceId}"`);
      return;
    }
    if (seenSources.has(src.sourceId)) error(at, `table "${src.sourceId}" appears twice`);
    seenSources.add(src.sourceId);
    if (src.decision === 'ignore') {
      if (src.targets.length > 0) error(at, 'an ignored table cannot have targets');
      return;
    }
    if (src.targets.length === 0) error(at, 'a mapped table needs at least one target');

    const columnCount = profiled.profile.columns.length;
    const unpivoted = src.rowRules.some((r) => r.rule === 'unpivot');
    const checkColumn = (path: string, ref: WireColumnRef) => {
      if (typeof ref === 'number') {
        if (ref >= columnCount)
          error(path, `column ${ref} doesn't exist (table has ${columnCount})`);
      } else if ((ref === 'unpivot_key' || ref === 'unpivot_value') && !unpivoted) {
        error(path, `"${ref}" needs an unpivot row rule`);
      } else if (ref === 'section' && profiled.profile.sections.length === 0) {
        warn(path, 'this table has no section headings');
      }
    };

    src.rowRules.forEach((rule, ri) => {
      const rp = `${at}.rowRules[${ri}]`;
      if (rule.rule === 'skip_rows' && rule.where) checkColumn(`${rp}.where`, rule.where.column);
      if (rule.rule === 'fill_down') {
        rule.columns.forEach((c) => checkColumn(rp, c));
        if (rule.withinGroup !== undefined) checkColumn(rp, rule.withinGroup);
      }
      if (rule.rule === 'unpivot') rule.columns.forEach((c) => checkColumn(rp, c));
    });

    src.targets.forEach((target, ti) => {
      const tp = `${at}.targets[${ti}]`;
      const entity = entities.get(target.entity);
      if (!entity) {
        error(tp, `unknown record type "${target.entity}"`);
        return;
      }
      if (target.grain === 'group' && !target.groupBy?.length)
        error(tp, 'grain "group" needs groupBy');
      target.groupBy?.forEach((c) => checkColumn(`${tp}.groupBy`, c));
      if (target.where) {
        checkColumn(`${tp}.where`, target.where.column);
        if (target.where.op === 'equals' && !target.where.values?.length)
          error(`${tp}.where`, '"equals" needs values');
      }
      validateFields(target, entity, tp);
    });

    function validateFields(target: TargetMapping, entity: PackEntity, tp: string) {
      const seen = new Set<string>();
      target.fields.forEach((m, fi) => {
        const fp = `${tp}.fields[${fi}]`;
        const def = entity.fields.find((f) => f.id === m.field);
        if (!def) {
          error(fp, `${entity.id} has no field "${m.field}"`);
          return;
        }
        if (seen.has(m.field)) error(fp, `${entity.id}.${m.field} is mapped twice`);
        seen.add(m.field);

        const s = m.source;
        if (s.kind === 'column') checkColumn(fp, s.column);
        if (s.kind === 'first_of') s.columns.forEach((c) => checkColumn(fp, c));
        if (s.kind === 'sequence') checkColumn(fp, s.within);
        if (s.kind === 'derive') {
          for (const f of exprFields(s.expr)) {
            if (!entity.fields.some((x) => x.id === f))
              error(fp, `formula uses unknown field "${f}"`);
          }
        }
        if (m.matchOn) {
          const ref = def.references ? entities.get(def.references) : undefined;
          if (!ref) error(fp, 'matchOn is only allowed on links to other records');
          else
            for (const k of m.matchOn) {
              if (!ref.fields.some((f) => f.id === k))
                error(fp, `${ref.id} has no field "${k}" to match on`);
            }
        }
        if (s.kind === 'column' && typeof s.column === 'number') checkTypeFit(fp, def, m, s.column);
      });

      const missing = missingRequired(target, entity);
      if (missing.length > 0)
        error(tp, `${entity.id} needs ${missing.map((f) => `"${f}"`).join(', ')}`);
    }

    function checkTypeFit(fp: string, def: PackField, m: FieldMapping, column: number) {
      const c = profiled!.profile.columns[column];
      if (!c || c.filled === 0) return;
      if (m.rules.some((r) => r.rule === 'map_values' || r.rule === 'month_start')) return;
      if (NUMERIC_TYPES.has(def.type)) {
        const ratio = (c.kinds.number + c.kinds.withUnit) / c.filled;
        if (ratio < TYPE_MATCH_MIN)
          warn(fp, `only ${Math.round(ratio * 100)}% of “${c.header}” look like numbers`);
      } else if (def.type === 'date' || def.type === 'datetime') {
        const ratio = c.kinds.date / c.filled;
        if (ratio < TYPE_MATCH_MIN)
          warn(fp, `only ${Math.round(ratio * 100)}% of “${c.header}” look like dates`);
      }
    }
  });

  for (const s of ctx.sources) {
    if (!seenSources.has(s.sourceId))
      warn('sources', `table "${s.sourceId}" (${s.sheetName}) isn't mentioned; it will be skipped`);
  }

  proposal.dedupe.forEach((d, di) => {
    if (!entities.has(d.entity)) error(`dedupe[${di}]`, `unknown record type "${d.entity}"`);
  });

  const sourceIds = new Set(proposal.sources.map((s) => s.sourceId));
  const questionIds = new Set<string>();
  proposal.questions.forEach((q, qi) => {
    const qp = `questions[${qi}]`;
    if (questionIds.has(q.id)) error(qp, `question id "${q.id}" is used twice`);
    questionIds.add(q.id);
    const optionIds = new Set(q.options.map((o) => o.id));
    if (optionIds.size !== q.options.length) error(qp, 'option ids must be unique');
    if (!optionIds.has(q.defaultOption))
      error(qp, `defaultOption "${q.defaultOption}" isn't an option`);
    q.options.forEach((o, oi) => {
      for (const message of effectProblems(o.effect, sourceIds, ctx))
        error(`${qp}.options[${oi}]`, message);
    });
  });

  const assumptionIds = new Set<string>();
  proposal.assumptions.forEach((a, ai) => {
    if (assumptionIds.has(a.id))
      error(`assumptions[${ai}]`, `assumption id "${a.id}" is used twice`);
    assumptionIds.add(a.id);
  });

  return { errors, warnings };
}

/** Problems with an effect's ids (used for question options and for user corrections). */
export function effectProblems(
  effect: QuestionEffect,
  sourceIds: ReadonlySet<string>,
  ctx: ValidationContext,
): string[] {
  const problems: string[] = [];
  const entity = (id: string) => ctx.pack.entities.find((e) => e.id === id);
  const checkSource = (id: string) => {
    if (!sourceIds.has(id)) problems.push(`unknown table "${id}"`);
  };
  const checkField = (e: string, f: string) => {
    const ent = entity(e);
    if (!ent) problems.push(`unknown record type "${e}"`);
    else if (!ent.fields.some((x) => x.id === f)) problems.push(`${e} has no field "${f}"`);
  };
  switch (effect.kind) {
    case 'none':
      break;
    case 'keep_dedupe':
    case 'drop_dedupe':
      if (!entity(effect.entity)) problems.push(`unknown record type "${effect.entity}"`);
      break;
    case 'set_date_order':
      effect.sourceIds.forEach(checkSource);
      break;
    case 'ignore_source':
      checkSource(effect.sourceId);
      break;
    case 'set_rules':
    case 'unmap_field':
      checkSource(effect.sourceId);
      checkField(effect.entity, effect.field);
      break;
    case 'map_column': {
      checkSource(effect.sourceId);
      checkField(effect.entity, effect.field);
      const profile = ctx.sources.find((s) => s.sourceId === effect.sourceId)?.profile;
      if (profile && typeof effect.column === 'number' && effect.column >= profile.columns.length)
        problems.push(`column ${effect.column} doesn't exist`);
      break;
    }
  }
  return problems;
}

/** Required fields of `entity` that the target leaves unmapped. */
export function missingRequired(target: TargetMapping, entity: PackEntity): string[] {
  const mapped = new Set(target.fields.map((f) => f.field));
  return entity.fields.filter((f) => f.required && !mapped.has(f.id)).map((f) => f.id);
}

/**
 * Drops targets that can't produce valid records because a required field isn't mapped, and says so
 * in an assumption (AI_DESIGN Task A: "the entity is dropped with an assumption").
 */
export function dropIncompleteTargets(proposal: ModelProposal, pack: PackData): ModelProposal {
  const entities = new Map(pack.entities.map((e) => [e.id, e]));
  const assumptions = [...proposal.assumptions];
  const sources = proposal.sources.map((src) => {
    const targets = src.targets.filter((t) => {
      const entity = entities.get(t.entity);
      if (!entity) return true; // reported by validateProposal
      const missing = missingRequired(t, entity);
      if (missing.length === 0) return true;
      const labels = missing.map((m) => entity.fields.find((f) => f.id === m)!.label.toLowerCase());
      assumptions.push({
        id: `dropped-${src.sourceId}-${t.entity}`.slice(0, 40),
        about: entity.label.plural.toLowerCase(),
        text: `We couldn’t find the ${labels.join(' and ')} for ${entity.label.plural.toLowerCase()} in this sheet, so we’ll leave them out for now.`,
        confidence: 0.5,
      });
      return false;
    });
    if (src.decision === 'map' && targets.length === 0)
      return {
        ...src,
        decision: 'ignore' as const,
        ignoreReason: 'Nothing we could bring in',
        targets,
      };
    return { ...src, targets };
  });
  return { ...proposal, sources, assumptions: assumptions.slice(0, 30) };
}
