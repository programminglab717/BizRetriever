import { getAppDb, metric } from '@bizr/db';
import { getPack } from '@bizr/packs';
import { and, eq, inArray } from 'drizzle-orm';

import { toAnswerData } from '../ask/answer';
import { periodLabel, resolvePreset } from '../ask/time';
import { kpiViews, localeFor, type KpiView } from '../ask/view';
import { QueryExecutionError } from '../executor/execute';
import { SemanticError } from '../semantic/graph';
import { compileContext, runQuery } from '../semantic/service';
import type { MemberWorkspace } from '../workspaces/service';

/**
 * Home's key numbers (PRODUCT_SPEC Journey 5): the last 30 days against the 30 before. Which ones
 * is the pack's choice (`key_numbers.home`, M14).
 */

export interface HomeKpis {
  kpis: KpiView[];
  comparedWith: string | null;
}

export async function homeKpis(
  member: MemberWorkspace,
  options: { now?: Date } = {},
): Promise<HomeKpis> {
  const ws = member.workspace;
  const homeKpis = getPack(ws.packId).manifest.key_numbers.home;
  if (homeKpis.length === 0) return { kpis: [], comparedWith: null };
  const available = new Set(
    (
      await getAppDb()
        .select({ key: metric.key })
        .from(metric)
        .where(
          and(
            eq(metric.workspaceId, ws.id),
            eq(metric.available, true),
            inArray(metric.key, [...homeKpis]),
          ),
        )
    ).map((m) => m.key),
  );
  const metrics = homeKpis.filter((k) => available.has(k));
  if (metrics.length === 0) return { kpis: [], comparedWith: null };
  const cc = compileContext(member, options.now);
  const cal = {
    today: cc.today,
    weekStart: cc.weekStart,
    fiscalYearStartMonth: cc.fiscalYearStartMonth,
  };
  try {
    const r = await runQuery(
      member,
      { metrics, period: resolvePreset('last_30_days', cal)!, compare: 'previous_period' },
      'dashboard',
    );
    return {
      kpis: kpiViews(toAnswerData(r), {
        pack: getPack(ws.packId),
        locale: localeFor(member.settings),
        currency: member.settings.currency,
        fiscalYearStartMonth: member.settings.fiscalYearStartMonth,
      }),
      comparedWith: r.previousPeriod ? periodLabel(r.previousPeriod) : null,
    };
  } catch (err) {
    if (err instanceof SemanticError || err instanceof QueryExecutionError)
      return { kpis: [], comparedWith: null };
    throw err;
  }
}
