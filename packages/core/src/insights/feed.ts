import {
  auditEvent,
  getAppDb,
  insight,
  insightRun,
  insightSetting,
  type Insight,
  type InsightRunRule,
} from '@bizr/db';
import { getPack, type InsightCategory, type PackInsightRule } from '@bizr/packs';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { compileContext } from '../semantic/service';
import { requireEditor, type MemberWorkspace } from '../workspaces/service';
import { effectiveThresholds } from './evaluate';

/** What Home, All insights and alert settings read and change. */

export class InsightError extends Error {}

export type InsightCard = Pick<
  Insight,
  | 'id'
  | 'ruleId'
  | 'category'
  | 'level'
  | 'headline'
  | 'context'
  | 'text'
  | 'action'
  | 'status'
  | 'firstSeenAt'
  | 'lastSeenAt'
  | 'assignedTo'
>;

const cardColumns = {
  id: insight.id,
  ruleId: insight.ruleId,
  category: insight.category,
  level: insight.level,
  headline: insight.headline,
  context: insight.context,
  text: insight.text,
  action: insight.action,
  status: insight.status,
  firstSeenAt: insight.firstSeenAt,
  lastSeenAt: insight.lastSeenAt,
  assignedTo: insight.assignedTo,
};

export interface LastRun {
  today: string;
  historyDays: number | null;
  finishedAt: Date | null;
  rules: InsightRunRule[];
}

export interface InsightOverview {
  insights: InsightCard[];
  lastRun: LastRun | null;
  /** No run yet, the data changed since, or a new day began: a run should be queued. */
  stale: boolean;
  /** Under about four weeks of sales: trend checks are still waiting. */
  waitingForHistory: boolean;
}

const active = inArray(insight.status, ['new', 'seen']);

export async function lastInsightRun(
  member: MemberWorkspace,
): Promise<(LastRun & { dataVersion: number }) | null> {
  const [run] = await getAppDb()
    .select({
      today: insightRun.today,
      historyDays: insightRun.historyDays,
      finishedAt: insightRun.finishedAt,
      rules: insightRun.rules,
      dataVersion: insightRun.dataVersion,
    })
    .from(insightRun)
    .where(eq(insightRun.workspaceId, member.workspace.id))
    .orderBy(desc(insightRun.startedAt))
    .limit(1);
  return run ?? null;
}

export async function getInsights(
  member: MemberWorkspace,
  options: {
    limit?: number;
    category?: InsightCategory;
    now?: Date;
    /** Only those handed to this person (Home's "For you", M13). */
    assignedTo?: string;
  } = {},
): Promise<InsightOverview> {
  const db = getAppDb();
  const insights = await db
    .select(cardColumns)
    .from(insight)
    .where(
      and(
        eq(insight.workspaceId, member.workspace.id),
        active,
        ...(options.category ? [eq(insight.category, options.category)] : []),
        ...(options.assignedTo ? [eq(insight.assignedTo, options.assignedTo)] : []),
      ),
    )
    .orderBy(desc(insight.score), desc(insight.lastSeenAt))
    .limit(options.limit ?? 100);
  const run = await lastInsightRun(member);
  const today = compileContext(member, options.now).today;
  const stale = !run || run.dataVersion < member.workspace.dataVersion || run.today < today;
  // Trends need about four weeks of sales (PRODUCT_SPEC Journey 5).
  const waitingForHistory = !!run && (run.historyDays ?? 0) < 28;
  if (!run) return { insights, lastRun: null, stale, waitingForHistory };
  const { dataVersion: _, ...lastRun } = run;
  return { insights, lastRun, stale, waitingForHistory };
}

/** New insights the person has now looked at. */
export async function markInsightsSeen(member: MemberWorkspace, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await getAppDb()
    .update(insight)
    .set({ status: 'seen', seenAt: new Date() })
    .where(
      and(
        eq(insight.workspaceId, member.workspace.id),
        inArray(insight.id, ids),
        eq(insight.status, 'new'),
      ),
    );
}

/** Hides an insight until it gets more serious. "Not useful" also records the feedback. */
export async function dismissInsight(
  member: MemberWorkspace,
  userId: string,
  id: string,
  options: { notUseful?: boolean } = {},
): Promise<void> {
  requireEditor(member);
  const db = getAppDb();
  const r = await db
    .update(insight)
    .set({
      status: 'dismissed',
      dismissedAt: new Date(),
      dismissedBy: userId,
      dismissedLevel: sql`${insight.level}`,
      ...(options.notUseful ? { feedback: 'not_useful' as const } : {}),
    })
    .where(and(eq(insight.workspaceId, member.workspace.id), eq(insight.id, id), active))
    .returning({ ruleId: insight.ruleId });
  if (r.length === 0) throw new InsightError('That insight is no longer showing.');
  await db.insert(auditEvent).values({
    workspaceId: member.workspace.id,
    userId,
    action: options.notUseful ? 'insight.not_useful' : 'insight.dismissed',
    details: { insightId: id, ruleId: r[0]!.ruleId },
  });
}

// --- Alert settings ---------------------------------------------------------------------------

export interface AlertThreshold {
  name: string;
  /** The sentence around the number, split at it ("Warn me when … within", "days"). */
  before: string;
  after: string;
  /** In the units people think in: percent thresholds as 10, not 0.1. */
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  unit: PackInsightRule['thresholds'][string]['unit'];
}

export interface AlertSetting {
  ruleId: string;
  label: string;
  description: string;
  category: InsightCategory;
  enabled: boolean;
  thresholds: AlertThreshold[];
}

const shownAsPercent = (unit: AlertThreshold['unit']) => unit === 'percent' || unit === 'points';
const toShown = (unit: AlertThreshold['unit'], v: number) =>
  shownAsPercent(unit) ? Math.round(v * 1000) / 10 : v;
const fromShown = (unit: AlertThreshold['unit'], v: number) => (shownAsPercent(unit) ? v / 100 : v);

export async function getAlertSettings(member: MemberWorkspace): Promise<AlertSetting[]> {
  const saved = new Map(
    (
      await getAppDb()
        .select()
        .from(insightSetting)
        .where(eq(insightSetting.workspaceId, member.workspace.id))
    ).map((s) => [s.ruleId, s]),
  );
  return getPack(member.workspace.packId).insights.rules.map((rule) => {
    const s = saved.get(rule.id);
    const values = effectiveThresholds(rule, s?.thresholds);
    return {
      ruleId: rule.id,
      label: rule.label,
      description: rule.description,
      category: rule.category,
      enabled: s?.enabled ?? rule.enabled,
      thresholds: Object.entries(rule.thresholds)
        .filter(([, t]) => t.editable)
        .map(([name, t]) => {
          const [before = '', after = ''] = t.label.split('{{value}}');
          return {
            name,
            before: before.trimEnd(),
            after: after.trimStart(),
            value: toShown(t.unit, values[name]!),
            defaultValue: toShown(t.unit, t.default),
            min: toShown(t.unit, t.min),
            max: toShown(t.unit, t.max),
            unit: t.unit,
          };
        }),
    };
  });
}

/** Saves one rule's toggle and thresholds (given as shown). Out-of-range numbers are refused. */
export async function saveAlertSetting(
  member: MemberWorkspace,
  userId: string,
  ruleId: string,
  input: { enabled: boolean; thresholds: Record<string, number> },
): Promise<void> {
  requireEditor(member);
  const rule = getPack(member.workspace.packId).insights.rules.find((r) => r.id === ruleId);
  if (!rule) throw new InsightError('That alert doesn’t exist.');
  const thresholds: Record<string, number> = {};
  for (const [name, shown] of Object.entries(input.thresholds)) {
    const t = rule.thresholds[name];
    if (!t || !t.editable) throw new InsightError('That setting can’t be changed.');
    if (!Number.isFinite(shown)) throw new InsightError('Please enter a number.');
    const v = fromShown(t.unit, shown);
    if (v < t.min || v > t.max)
      throw new InsightError(
        `Please pick a number from ${toShown(t.unit, t.min)} to ${toShown(t.unit, t.max)}.`,
      );
    thresholds[name] = v;
  }
  const db = getAppDb();
  await db
    .insert(insightSetting)
    .values({
      workspaceId: member.workspace.id,
      ruleId,
      enabled: input.enabled,
      thresholds,
      updatedBy: userId,
    })
    .onConflictDoUpdate({
      target: [insightSetting.workspaceId, insightSetting.ruleId],
      set: { enabled: input.enabled, thresholds, updatedBy: userId, updatedAt: new Date() },
    });
  await db.insert(auditEvent).values({
    workspaceId: member.workspace.id,
    userId,
    action: 'insight.settings_changed',
    details: { ruleId, enabled: input.enabled, thresholds },
  });
}
