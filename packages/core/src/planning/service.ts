import { getPack, type MetricFormat } from '@bizr/packs';

import { toAnswerData } from '../ask/answer';
import { QueryExecutionError } from '../executor/execute';
import { SemanticError } from '../semantic/graph';
import type { SemanticModel } from '../semantic/model';
import { compileContext, loadSemanticModel, runQuery } from '../semantic/service';
import type { MemberWorkspace } from '../workspaces/service';
import { addDays, forecastDaily, type DayValue, type Forecast } from './forecast';

/**
 * Estimates for a business (M11, ADR-060): the measure's daily history comes from an executed query
 * (the same measure definitions as everywhere else), the estimate from the pure engine. Only the
 * pack's planning measures can be estimated; today isn't history yet (its sales aren't all in).
 */

/** Two years and a bit: enough for the year-on-year method and its range. */
const HISTORY_DAYS = 800;

export interface MetricEstimate {
  metric: { id: string; label: string; format: MetricFormat };
  /** The first estimated day (today) and how many. */
  from: string;
  days: number;
  forecast: Forecast | null;
}

export class PlanningError extends Error {}

export function planningMetrics(packId: string): { goals: string[]; forecasts: string[] } {
  const p = getPack(packId).manifest.planning;
  return { goals: [...p.goals], forecasts: [...p.forecasts] };
}

/** The measure's value for every day up to yesterday (days without any are left out). */
export async function dailyHistory(
  member: MemberWorkspace,
  metricId: string,
  options: { now?: Date; model?: SemanticModel } = {},
): Promise<{ today: string; history: DayValue[]; label: string; format: MetricFormat }> {
  const model = options.model ?? (await loadSemanticModel(member.workspace));
  const def = model.metrics.get(metricId);
  if (!def) throw new PlanningError('That isn’t something we can estimate for this business.');
  const today = compileContext(member, options.now).today;
  const r = await runQuery(
    member,
    {
      metrics: [metricId],
      dimensions: [{ time: 'day' }],
      period: { from: addDays(today, -HISTORY_DAYS), to: today },
    },
    'system',
    model,
  );
  const data = toAnswerData(r);
  const day = data.columns.find((c) => c.time === 'day')!;
  const value = data.columns.find((c) => c.kind === 'metric')!;
  const history = data.rows.flatMap((row) => {
    const d = row[day.key];
    const v = Number(row[value.key]);
    return typeof d === 'string' && Number.isFinite(v) ? [{ date: d, value: v }] : [];
  });
  return { today, history, label: def.label, format: def.format };
}

/** The next `days` days of a planning measure, from today. Null forecast: too little history. */
export async function estimateMetric(
  member: MemberWorkspace,
  metricId: string,
  options: { days: number; now?: Date; model?: SemanticModel },
): Promise<MetricEstimate> {
  const { forecasts, goals } = planningMetrics(member.workspace.packId);
  if (!forecasts.includes(metricId) && !goals.includes(metricId))
    throw new PlanningError('That isn’t something we can estimate for this business.');
  try {
    const h = await dailyHistory(member, metricId, options);
    return {
      metric: { id: metricId, label: h.label, format: h.format },
      from: h.today,
      days: options.days,
      forecast: forecastDaily(h.history, { from: h.today, days: options.days }),
    };
  } catch (err) {
    // A measure the data can't give yet (no sales recorded) has nothing to estimate.
    if (err instanceof SemanticError || err instanceof QueryExecutionError)
      return {
        metric: { id: metricId, label: metricId, format: 'number' },
        from: compileContext(member, options.now).today,
        days: options.days,
        forecast: null,
      };
    throw err;
  }
}
