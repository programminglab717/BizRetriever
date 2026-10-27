import { auditEvent, getAppDb, goal } from '@bizr/db';
import type { MetricFormat } from '@bizr/packs';
import { and, asc, eq } from 'drizzle-orm';

import { toAnswerData } from '../ask/answer';
import { loadSemanticModel, runQuery } from '../semantic/service';
import { requireEditor, type MemberWorkspace } from '../workspaces/service';
import { addDays, forecastDaily, type ForecastNote } from './forecast';
import { dailyHistory, planningMetrics, PlanningError } from './service';

/**
 * Monthly goals (M11, ADR-060). "So far" is the measure for this month to date, from the same query
 * the rest of the app uses. "Heading for" is what's been sold up to yesterday plus the estimate for
 * the rest of the month, with the estimate's range: an estimate, labelled as one.
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export interface GoalProgress {
  metric: { id: string; label: string; format: MetricFormat };
  /** Exact decimal string, as set. */
  target: string;
  month: { from: string; to: string; label: string };
  /** This month so far (money as an exact decimal string). */
  soFar: string | number;
  /** soFar / target. */
  share: number;
  /** Estimated month total and its range; null when there's too little history. */
  projected: { total: number; low: number; high: number } | null;
  status: 'reached' | 'ahead' | 'on_track' | 'behind' | 'unknown';
  /** What each remaining day (today included) would need to reach the goal. */
  perDayNeeded: number;
  daysLeft: number;
  notes: ForecastNote[];
}

/** "12,000", "$12,000.50", "12000" → "12000.50"; null for anything else. */
export function parseTarget(text: string): string | null {
  const s = text.replace(/[\s,$£€¥]/g, '');
  if (!/^\d{1,13}(\.\d{1,4})?$/.test(s)) return null;
  return Number(s) > 0 ? s.replace(/^0+(?=\d)/, '') : null;
}

export async function listGoals(member: MemberWorkspace) {
  return getAppDb()
    .select({ metricKey: goal.metricKey, target: goal.target })
    .from(goal)
    .where(eq(goal.workspaceId, member.workspace.id))
    .orderBy(asc(goal.createdAt));
}

export async function setGoal(
  member: MemberWorkspace,
  userId: string,
  metricKey: string,
  targetText: string,
): Promise<void> {
  requireEditor(member);
  if (!planningMetrics(member.workspace.packId).goals.includes(metricKey))
    throw new PlanningError('You can’t set a goal for that.');
  const model = await loadSemanticModel(member.workspace);
  if (!model.metrics.has(metricKey))
    throw new PlanningError('Your data doesn’t have what that goal needs yet.');
  const target = parseTarget(targetText);
  if (!target) throw new PlanningError('Please enter the goal as a number, like 12000.');
  const db = getAppDb();
  await db
    .insert(goal)
    .values({ workspaceId: member.workspace.id, metricKey, target, createdBy: userId })
    .onConflictDoUpdate({
      target: [goal.workspaceId, goal.metricKey],
      set: { target, updatedAt: new Date() },
    });
  await db.insert(auditEvent).values({
    workspaceId: member.workspace.id,
    userId,
    action: 'goal.set',
    details: { metric: metricKey, target },
  });
}

export async function removeGoal(
  member: MemberWorkspace,
  userId: string,
  metricKey: string,
): Promise<void> {
  requireEditor(member);
  const db = getAppDb();
  await db
    .delete(goal)
    .where(and(eq(goal.workspaceId, member.workspace.id), eq(goal.metricKey, metricKey)));
  await db.insert(auditEvent).values({
    workspaceId: member.workspace.id,
    userId,
    action: 'goal.removed',
    details: { metric: metricKey },
  });
}

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Every goal's progress this month, for Home, the plan page and the weekly email. */
export async function goalProgress(
  member: MemberWorkspace,
  options: { now?: Date } = {},
): Promise<GoalProgress[]> {
  const goals = await listGoals(member);
  if (goals.length === 0) return [];
  const model = await loadSemanticModel(member.workspace);
  const out: GoalProgress[] = [];
  for (const g of goals) {
    if (!model.metrics.has(g.metricKey)) continue;
    const h = await dailyHistory(member, g.metricKey, { model, ...options });
    const today = h.today;
    const from = `${today.slice(0, 8)}01`;
    const next = new Date(`${from}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const to = next.toISOString().slice(0, 10);
    const daysLeft = daysBetween(today, to);

    const r = await runQuery(
      member,
      { metrics: [g.metricKey], period: { from, to: addDays(today, 1) } },
      'system',
      model,
    );
    const data = toAnswerData(r);
    const col = data.columns.find((c) => c.kind === 'metric')!;
    const soFar = data.rows[0]?.[col.key] ?? (h.format === 'money' ? '0' : 0);
    const target = Number(g.target);
    const share = target > 0 ? Number(soFar) / target : 0;

    const beforeToday = h.history
      .filter((d) => d.date >= from && d.date < today)
      .reduce((a, d) => a + d.value, 0);
    const f = forecastDaily(h.history, { from: today, days: daysLeft });
    const projected = f
      ? { total: beforeToday + f.total, low: beforeToday + f.low, high: beforeToday + f.high }
      : null;
    const status: GoalProgress['status'] =
      Number(soFar) >= target
        ? 'reached'
        : !projected
          ? 'unknown'
          : projected.total >= target * 1.05
            ? 'ahead'
            : projected.total >= target * 0.97
              ? 'on_track'
              : 'behind';
    out.push({
      metric: { id: g.metricKey, label: h.label, format: h.format },
      target: g.target,
      month: { from, to, label: `${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}` },
      soFar: soFar === null ? 0 : soFar,
      share,
      projected,
      status,
      perDayNeeded: Math.max(0, (target - Number(soFar)) / Math.max(1, daysLeft)),
      daysLeft,
      notes: f?.notes ?? [],
    });
  }
  return out;
}
