import { dashboard, dashboardTile, getAppDb } from '@bizr/db';
import { getPack } from '@bizr/packs';
import { getLogger } from '@bizr/platform';
import { and, asc, eq } from 'drizzle-orm';

import { QueryExecutionError } from '../executor/execute';
import { SemanticError } from '../semantic/graph';
import { compileContext, loadSemanticModel, runQuery } from '../semantic/service';
import type { MemberWorkspace } from '../workspaces/service';
import { chooseChart, toAnswerData } from './answer';
import { questionSpecSchema, toQuerySpec, type ChartType } from './interpretation';
import { localeFor } from './service';
import { kpiViews, tableView, type KpiView, type TableView } from './view';

/**
 * Pinned tiles on the default dashboard, each re-run live (PRODUCT_SPEC §3). M5 adds the pack's
 * default tiles, the date range picker and editing.
 */

export interface TileView {
  id: string;
  title: string;
  chart: ChartType;
  fixedDates: boolean;
  table?: TableView;
  kpis?: KpiView[];
  error?: string;
}

export async function dashboardTiles(member: MemberWorkspace): Promise<TileView[]> {
  const ws = member.workspace;
  const db = getAppDb();
  const tiles = await db
    .select({ tile: dashboardTile })
    .from(dashboardTile)
    .innerJoin(dashboard, eq(dashboard.id, dashboardTile.dashboardId))
    .where(and(eq(dashboard.workspaceId, ws.id), eq(dashboard.isDefault, true)))
    .orderBy(asc(dashboardTile.position));
  if (tiles.length === 0) return [];
  const model = await loadSemanticModel(ws);
  const cc = compileContext(member);
  const cal = {
    today: cc.today,
    weekStart: cc.weekStart,
    fiscalYearStartMonth: cc.fiscalYearStartMonth,
  };
  const options = {
    pack: getPack(ws.packId),
    locale: localeFor(member.settings),
    currency: member.settings.currency,
    fiscalYearStartMonth: cc.fiscalYearStartMonth,
  };
  return Promise.all(
    tiles.map(async ({ tile }): Promise<TileView> => {
      const base = { id: tile.id, title: tile.title, fixedDates: tile.fixedDates };
      const spec = questionSpecSchema.safeParse(tile.spec);
      if (!spec.success)
        return { ...base, chart: 'table', error: 'This tile can’t be shown any more.' };
      try {
        const r = await runQuery(member, toQuerySpec(spec.data, cal), 'dashboard', model);
        const data = toAnswerData(r);
        const chart = chooseChart(data, spec.data, tile.chart as ChartType);
        return { ...base, chart, table: tableView(data, options), kpis: kpiViews(data, options) };
      } catch (err) {
        if (err instanceof SemanticError || err instanceof QueryExecutionError) {
          getLogger('dashboard').warn({ err, tile: tile.id }, 'tile failed');
          return { ...base, chart: 'table', error: 'Couldn’t load this.' };
        }
        throw err;
      }
    }),
  );
}
