import type { MaterializeResult } from './materialize';

/**
 * Turns a dry run's results into problems worth a revision (AI_DESIGN Task A, "Dry run"): a mapped
 * detail that fails to read on more than 20% of lines, or a link that matches fewer than half of its
 * records. The texts go to the AI inside <workspace_data> (they quote the files) and to logs.
 */

export const FAILURE_RATE_LIMIT = 0.2;
export const MATCH_RATE_MIN = 0.5;
const MIN_SAMPLE = 5;

export interface DryRunProblem {
  kind: 'unreadable' | 'missing_required' | 'unmatched';
  sourceId?: string;
  entity: string;
  field: string;
  rate: number;
  text: string;
}

export function dryRunProblems(result: MaterializeResult): DryRunProblem[] {
  const problems: DryRunProblem[] = [];
  const rowsIn = new Map(result.stats.sources.map((s) => [s.sourceId, s]));

  const grouped = new Map<string, { count: number; examples: string[] }>();
  for (const issue of result.issues) {
    if (issue.code === 'unmatched_reference' || !issue.field) continue;
    const key = `${issue.code}|${issue.sourceId}|${issue.entity}|${issue.field}`;
    const g = grouped.get(key) ?? { count: 0, examples: [] };
    g.count += 1;
    if (g.examples.length < 3) g.examples.push(issue.message);
    grouped.set(key, g);
  }
  for (const [key, g] of grouped) {
    const [code, sourceId, entity, field] = key.split('|') as [string, string, string, string];
    const stat = rowsIn.get(sourceId);
    const total = Math.max(1, stat?.rowsIn ?? 0);
    const rate = g.count / total;
    if (total < MIN_SAMPLE || rate <= FAILURE_RATE_LIMIT) continue;
    const where = stat ? `“${stat.sheet}” in “${stat.fileName}” (${sourceId})` : sourceId;
    problems.push({
      kind: code === 'missing_required' ? 'missing_required' : 'unreadable',
      sourceId,
      entity,
      field,
      rate,
      text:
        code === 'missing_required'
          ? `${where}: ${g.count} of ${total} lines have no ${entity}.${field}, which is required.`
          : `${where}: ${entity}.${field} couldn't be read on ${g.count} of ${total} lines, e.g. ${g.examples.join('; ')}.`,
    });
  }

  for (const r of result.stats.references) {
    const total = r.matched + r.unmatched;
    if (total < MIN_SAMPLE) continue;
    const rate = r.matched / total;
    if (rate >= MATCH_RATE_MIN) continue;
    problems.push({
      kind: 'unmatched',
      entity: r.entity,
      field: r.field,
      rate,
      text: `${r.entity}.${r.field} matched only ${r.matched} of ${total} ${r.target} records, e.g. unmatched ${r.unmatchedExamples
        .slice(0, 3)
        .map((e) => `“${e}”`)
        .join(', ')}.`,
    });
  }
  return problems;
}
