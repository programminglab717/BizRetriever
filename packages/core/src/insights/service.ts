import {
  getAppDb,
  insight,
  insightRun,
  insightSetting,
  workspace,
  workspaceSettings,
  type InsightLevel,
  type InsightRunRule,
  type StoredInsightAction,
  type Workspace,
  type WorkspaceSettings,
} from '@bizr/db';
import { getPack, type InsightPeriod, type InsightQuery, type PackInsightRule } from '@bizr/packs';
import { getLogger } from '@bizr/platform';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';

import { localeFor } from '../ask/view';
import { executeTenantQuery } from '../executor/execute';
import { compileQuery } from '../semantic/compile';
import { SemanticError } from '../semantic/graph';
import type { CompileContext, SemanticModel } from '../semantic/model';
import type { QuerySpecInput } from '../semantic/query-spec';
import { compileContext, loadSemanticModel } from '../semantic/service';
import { ensureWeeklyDigest } from './digest';
import { effectiveThresholds, evaluateRule, type Candidate, type Row } from './evaluate';
import { insightText, renderInsight, type RenderOptions } from './render';

/**
 * `insights.run` (AI_DESIGN §7): runs every enabled pack rule over a workspace's data through the
 * safe executor, then keeps `app.insight` in step: new findings are added, ones that still hold are
 * refreshed, and ones that no longer hold are marked resolved. Dismissed findings stay hidden unless
 * they get more serious.
 */

export interface InsightTarget {
  workspace: Workspace;
  settings: WorkspaceSettings;
}

export interface InsightRunSummary {
  runId: string;
  today: string;
  historyDays: number | null;
  rules: InsightRunRule[];
  created: number;
  updated: number;
  resolved: number;
}

const EPOCH = '1900-01-01';
const DAY_MS = 86_400_000;
const RANK: Record<InsightLevel, number> = { info: 1, warn: 2, urgent: 3 };
const log = () => getLogger('insights');

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Rule dates are relative to today, which isn't included (its sales aren't all in yet). */
export function periodFor(p: InsightPeriod, today: string): { from: string; to: string } {
  if ('last_days' in p) return { from: addDays(today, -p.last_days), to: today };
  if ('days_ago' in p)
    return { from: addDays(today, -p.days_ago[0]), to: addDays(today, -p.days_ago[1]) };
  return { from: EPOCH, to: today };
}

export function specFor(q: InsightQuery, today: string): QuerySpecInput {
  return {
    metrics: q.metrics,
    dimensions: q.dimensions,
    filters: q.filters,
    period: periodFor(q.period, today),
    ...(q.compare ? { compare: q.compare } : {}),
    having: q.having,
    ...(q.sort ? { sort: q.sort } : {}),
    ...(q.limit ? { limit: q.limit } : {}),
  };
}

export async function loadInsightTarget(workspaceId: string): Promise<InsightTarget | undefined> {
  const [row] = await getAppDb()
    .select({ workspace, settings: workspaceSettings })
    .from(workspace)
    .innerJoin(workspaceSettings, eq(workspaceSettings.workspaceId, workspace.id))
    .where(eq(workspace.id, workspaceId));
  return row;
}

async function runSpec(
  target: InsightTarget,
  model: SemanticModel,
  ctx: CompileContext,
  spec: QuerySpecInput,
): Promise<Row[]> {
  const q = compileQuery(model, spec, ctx);
  const r = await executeTenantQuery({
    tenant: { workspaceId: target.workspace.id, tenantSchema: target.workspace.tenantSchema },
    sql: q.sql,
    params: q.params,
    origin: 'insight',
    path: 'spec',
    timeoutMs: 15_000,
    rowLimit: 5_000,
  });
  return r.rows;
}

/** Days from the first sale to today; null without sales. */
async function historyDays(
  target: InsightTarget,
  model: SemanticModel,
  ctx: CompileContext,
): Promise<number | null> {
  try {
    const [first] = await runSpec(target, model, ctx, {
      metrics: ['order_count'],
      dimensions: [{ time: 'day' }],
      period: { from: EPOCH, to: ctx.today },
      sort: { by: 'd0', dir: 'asc' },
      limit: 1,
    });
    const d = first?.d0;
    const iso =
      d instanceof Date
        ? d.toISOString().slice(0, 10)
        : typeof d === 'string'
          ? d.slice(0, 10)
          : null;
    return iso ? daysBetween(iso, ctx.today) : null;
  } catch (err) {
    if (err instanceof SemanticError) return null;
    throw err;
  }
}

function plainFill(text: string, c: Candidate, o: RenderOptions): string {
  return insightText(renderInsight(text.replaceAll('**', ''), c.facts, o));
}

export interface RenderedInsight {
  candidate: Candidate;
  headline: ReturnType<typeof renderInsight>;
  context: ReturnType<typeof renderInsight> | null;
  text: string;
  action: StoredInsightAction | null;
}

export function renderCandidate(
  rule: PackInsightRule,
  c: Candidate,
  o: RenderOptions,
  template = rule.template,
): RenderedInsight {
  const headline = renderInsight(template, c.facts, o);
  const a = rule.action;
  return {
    candidate: c,
    headline,
    context: rule.context ? renderInsight(rule.context, c.facts, o) : null,
    text: insightText(headline),
    action: !a
      ? null
      : 'ask' in a
        ? { kind: 'ask', label: a.label, question: plainFill(a.ask, c, o) }
        : { kind: 'records', label: a.label, entity: a.records, search: c.search },
  };
}

export interface RunOptions {
  trigger: string;
  /** For tests and demos: the moment "today" is taken from (in the business's timezone). */
  now?: Date;
}

/** Runs the pack's rules for one workspace and stores what they found. */
export async function runInsights(
  target: InsightTarget,
  options: RunOptions,
): Promise<InsightRunSummary> {
  const ws = target.workspace;
  const now = options.now ?? new Date();
  const db = getAppDb();
  const pack = getPack(ws.packId);
  const model = await loadSemanticModel(ws);
  const ctx = compileContext(target, now);
  const o: RenderOptions = {
    locale: localeFor(target.settings),
    currency: target.settings.currency,
  };
  const valueLabels = Object.fromEntries(
    pack.metrics.dimensions
      .filter((d) => Object.keys(d.value_labels).length > 0)
      .map((d) => [d.field, d.value_labels]),
  );
  const saved = new Map(
    (await db.select().from(insightSetting).where(eq(insightSetting.workspaceId, ws.id))).map(
      (s) => [s.ruleId, s],
    ),
  );
  const history = await historyDays(target, model, ctx);

  const rules: InsightRunRule[] = [];
  const found: { rule: PackInsightRule; rendered: RenderedInsight }[] = [];
  for (const rule of pack.insights.rules) {
    const setting = saved.get(rule.id);
    if (!(setting?.enabled ?? rule.enabled)) {
      rules.push({ id: rule.id, status: 'skipped', reason: 'Turned off in alert settings.' });
      continue;
    }
    if (rule.needs_history_days > 0 && (history ?? 0) < rule.needs_history_days) {
      rules.push({
        id: rule.id,
        status: 'skipped',
        reason: `Needs about ${Math.ceil(rule.needs_history_days / 7)} weeks of sales history.`,
      });
      continue;
    }
    try {
      const results: Record<string, Row[]> = {};
      for (const [name, q] of Object.entries(rule.queries))
        results[name] = await runSpec(target, model, ctx, specFor(q, ctx.today));
      const candidates = evaluateRule({
        rule,
        thresholds: effectiveThresholds(rule, setting?.thresholds),
        results,
        valueLabels,
      });
      for (const c of candidates) found.push({ rule, rendered: renderCandidate(rule, c, o) });
      rules.push({ id: rule.id, status: 'ran', found: candidates.length });
    } catch (err) {
      if (err instanceof SemanticError) {
        rules.push({ id: rule.id, status: 'skipped', reason: err.userMessage });
        continue;
      }
      log().error({ err, workspaceId: ws.id, rule: rule.id }, 'insight rule failed');
      rules.push({ id: rule.id, status: 'failed', reason: 'This check didn’t finish.' });
    }
  }

  const counts = await store(ws.id, found, rules, now);
  const [run] = await db
    .insert(insightRun)
    .values({
      workspaceId: ws.id,
      trigger: options.trigger,
      today: ctx.today,
      dataVersion: ws.dataVersion,
      historyDays: history,
      rules,
      ...counts,
      startedAt: now,
      finishedAt: new Date(),
    })
    .returning({ id: insightRun.id });
  log().info({ workspaceId: ws.id, ...counts, trigger: options.trigger }, 'insights run');
  // The first run of a week writes its digest.
  await ensureWeeklyDigest(target, { now });
  return { runId: run!.id, today: ctx.today, historyDays: history, rules, ...counts };
}

/** The lifecycle (ADR-047): one row per fingerprint, refreshed, reopened or resolved. */
async function store(
  workspaceId: string,
  found: { rule: PackInsightRule; rendered: RenderedInsight }[],
  rules: InsightRunRule[],
  now: Date,
): Promise<{ created: number; updated: number; resolved: number }> {
  const db = getAppDb();
  return db.transaction(async (tx) => {
    // One run at a time per workspace (a cron run and a data change can overlap).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId}, 47))`);
    const prints = found.map((f) => f.rendered.candidate.fingerprint);
    const existing = new Map(
      (prints.length
        ? await tx
            .select()
            .from(insight)
            .where(and(eq(insight.workspaceId, workspaceId), inArray(insight.fingerprint, prints)))
        : []
      ).map((r) => [r.fingerprint, r]),
    );
    let created = 0;
    let updated = 0;
    for (const { rule, rendered } of found) {
      const c = rendered.candidate;
      const content = {
        ruleId: c.ruleId,
        subject: c.key,
        category: c.category,
        level: c.level,
        score: c.score,
        impact: c.impact,
        facts: c.facts,
        headline: rendered.headline,
        context: rendered.context,
        text: rendered.text,
        action: rendered.action,
        phrasedBy: null,
        lastSeenAt: now,
        resolvedAt: null,
      };
      const r = existing.get(c.fingerprint);
      if (!r) {
        await tx
          .insert(insight)
          .values({ workspaceId, fingerprint: c.fingerprint, ...content, firstSeenAt: now });
        created += 1;
        continue;
      }
      const cooldown = now.getTime() - rule.cooldown_days * DAY_MS;
      let status = r.status;
      let dismissed = {
        dismissedAt: r.dismissedAt,
        dismissedBy: r.dismissedBy,
        dismissedLevel: r.dismissedLevel,
      };
      if (r.dismissedAt) {
        // Dismissed: hidden while it holds, unless it gets more serious than when dismissed.
        if (RANK[c.level] > RANK[r.dismissedLevel ?? r.level]) {
          status = 'new';
          dismissed = { dismissedAt: null, dismissedBy: null, dismissedLevel: null };
        } else status = 'dismissed';
      } else if (r.status === 'resolved') {
        // Back again: only "new" if it had gone for longer than the rule's cooldown.
        status = r.resolvedAt && r.resolvedAt.getTime() > cooldown && r.seenAt ? 'seen' : 'new';
      } else if (r.status === 'seen' && RANK[c.level] > RANK[r.level]) status = 'new';
      await tx
        .update(insight)
        .set({ ...content, ...dismissed, status })
        .where(eq(insight.id, r.id));
      updated += 1;
    }
    // Whatever a rule that ran (or was switched off or can't run) didn't find again is resolved.
    // A rule that failed leaves its insights as they were.
    const failed = rules.filter((r) => r.status === 'failed').map((r) => r.id);
    const gone = await tx
      .update(insight)
      .set({ status: 'resolved', resolvedAt: now })
      .where(
        and(
          eq(insight.workspaceId, workspaceId),
          inArray(insight.status, ['new', 'seen', 'dismissed']),
          ...(prints.length ? [notInArray(insight.fingerprint, prints)] : []),
          ...(failed.length ? [notInArray(insight.ruleId, failed)] : []),
        ),
      )
      .returning({ id: insight.id });
    return { created, updated, resolved: gone.length };
  });
}
