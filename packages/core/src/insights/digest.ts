import { digest, getAppDb, insight, metric } from '@bizr/db';
import { getPack } from '@bizr/packs';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';

import { localeFor } from '../ask/view';
import { executeTenantQuery } from '../executor/execute';
import { compileQuery } from '../semantic/compile';
import { SemanticError } from '../semantic/graph';
import { compileContext, loadSemanticModel } from '../semantic/service';
import { toNumber, type FactValue } from './evaluate';
import { formatInsightFact } from './render';
import type { InsightTarget } from './service';

/**
 * The weekly digest (PRODUCT_SPEC Journey 5): a card on Home for the week starting on the business's
 * first day of the week. It compares the last full week with the one before, lists the top three
 * new insights and suggests one question. Built once per week, by the first insight run of that week.
 */

export interface DigestKpi {
  label: string;
  value: string;
  previous: string;
  /** "+12%" / "−8%"; null when there's nothing to compare with. */
  change: string | null;
  direction: 'up' | 'down' | 'flat';
  goodDirection: 'up' | 'down' | 'neutral';
}

export interface DigestContent {
  weekOf: string;
  /** The week summarised: `to` is exclusive (it's `weekOf`). */
  period: { from: string; to: string };
  kpis: DigestKpi[];
  insights: { id: string; text: string; level: string }[];
  question: string | null;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The latest `weekStart` day (1 = Monday … 7 = Sunday) on or before `today`. */
export function weekOf(today: string, weekStart: number): string {
  const iso = ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  return addDays(today, -((iso - weekStart + 7) % 7));
}

const KPIS = ['net_sales', 'order_count'] as const;

export async function ensureWeeklyDigest(
  target: InsightTarget,
  options: { now?: Date } = {},
): Promise<DigestContent | null> {
  const ws = target.workspace;
  const db = getAppDb();
  const ctx = compileContext(target, options.now);
  const week = weekOf(ctx.today, target.settings.weekStart);
  const [existing] = await db
    .select({ id: digest.id })
    .from(digest)
    .where(and(eq(digest.workspaceId, ws.id), eq(digest.weekOf, week)));
  if (existing) return null;

  const pack = getPack(ws.packId);
  const model = await loadSemanticModel(ws);
  const available = new Set(
    (
      await db
        .select({ key: metric.key })
        .from(metric)
        .where(and(eq(metric.workspaceId, ws.id), eq(metric.available, true)))
    ).map((m) => m.key),
  );
  const ids = KPIS.filter((k) => available.has(k));
  // Nothing to summarise without sales.
  if (ids.length === 0) return null;

  const period = { from: addDays(week, -7), to: week };
  const o = { locale: localeFor(target.settings), currency: target.settings.currency };
  let kpis: DigestKpi[] = [];
  try {
    const q = compileQuery(model, { metrics: [...ids], period, compare: 'previous_period' }, ctx);
    const r = await executeTenantQuery({
      tenant: { workspaceId: ws.id, tenantSchema: ws.tenantSchema },
      sql: q.sql,
      params: q.params,
      origin: 'insight',
      path: 'spec',
      timeoutMs: 15_000,
    });
    const row = r.rows[0] ?? {};
    kpis = ids.map((id) => {
      const m = pack.metrics.metrics.find((x) => x.id === id)!;
      const now = toNumber(row[`m_${id}`]) ?? 0;
      const before = toNumber(row[`m_${id}__prev`]) ?? 0;
      const fact = (v: number, raw: unknown): FactValue =>
        m.format === 'money'
          ? { format: 'money', value: v, ...(typeof raw === 'string' ? { exact: raw } : {}) }
          : { format: 'integer', value: v };
      const change = before ? now / before - 1 : null;
      return {
        label: model.metrics.get(id)?.label ?? m.label,
        value: formatInsightFact(fact(now, row[`m_${id}`]), o),
        previous: formatInsightFact(fact(before, row[`m_${id}__prev`]), o),
        change:
          change === null
            ? null
            : `${change >= 0 ? '+' : '−'}${formatInsightFact({ format: 'percent', value: Math.abs(change) }, o)}`,
        direction: now > before ? 'up' : now < before ? 'down' : 'flat',
        goodDirection: m.good_direction,
      };
    });
  } catch (err) {
    if (!(err instanceof SemanticError)) throw err;
  }

  const activeNow = inArray(insight.status, ['new', 'seen']);
  const since = new Date(`${period.from}T00:00:00Z`);
  let top = await db
    .select({ id: insight.id, text: insight.text, level: insight.level, action: insight.action })
    .from(insight)
    .where(and(eq(insight.workspaceId, ws.id), activeNow, gte(insight.firstSeenAt, since)))
    .orderBy(desc(insight.score))
    .limit(3);
  if (top.length === 0)
    top = await db
      .select({ id: insight.id, text: insight.text, level: insight.level, action: insight.action })
      .from(insight)
      .where(and(eq(insight.workspaceId, ws.id), activeNow))
      .orderBy(desc(insight.score))
      .limit(3);

  const fromInsight = top.find((t) => t.action?.kind === 'ask')?.action;
  const examples = pack.questions.filter((q) => q.needs.every((n) => available.has(n)));
  const weekNo = Math.floor(Date.parse(`${week}T00:00:00Z`) / (7 * 86_400_000));
  const question =
    fromInsight?.kind === 'ask'
      ? fromInsight.question
      : (examples[weekNo % Math.max(1, examples.length)]?.text ?? null);

  const content: DigestContent = {
    weekOf: week,
    period,
    kpis,
    insights: top.map(({ id, text, level }) => ({ id, text, level })),
    question,
  };
  const inserted = await db
    .insert(digest)
    .values({ workspaceId: ws.id, weekOf: week, content })
    .onConflictDoNothing()
    .returning({ id: digest.id });
  return inserted.length ? content : null;
}

export async function currentDigest(
  target: InsightTarget,
  options: { now?: Date } = {},
): Promise<{ id: string; content: DigestContent } | null> {
  const week = weekOf(compileContext(target, options.now).today, target.settings.weekStart);
  const [row] = await getAppDb()
    .select({ id: digest.id, content: digest.content, dismissedAt: digest.dismissedAt })
    .from(digest)
    .where(and(eq(digest.workspaceId, target.workspace.id), eq(digest.weekOf, week)));
  if (!row || row.dismissedAt) return null;
  const content = row.content as DigestContent;
  // What the owner dismissed since stays out of the summary too.
  const ids = content.insights.map((i) => i.id);
  const hidden = new Set(
    ids.length
      ? (
          await getAppDb()
            .select({ id: insight.id })
            .from(insight)
            .where(and(inArray(insight.id, ids), eq(insight.status, 'dismissed')))
        ).map((r) => r.id)
      : [],
  );
  return {
    id: row.id,
    content: { ...content, insights: content.insights.filter((i) => !hidden.has(i.id)) },
  };
}

export async function dismissDigest(target: InsightTarget, id: string): Promise<void> {
  await getAppDb()
    .update(digest)
    .set({ dismissedAt: new Date() })
    .where(and(eq(digest.workspaceId, target.workspace.id), eq(digest.id, id)));
}
