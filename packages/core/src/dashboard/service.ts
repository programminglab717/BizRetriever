import {
  dashboard,
  dashboardTile,
  dashboardVersion,
  getAppDb,
  metric,
  workspace,
  type DashboardSettings,
} from '@bizr/db';
import { getPack } from '@bizr/packs';
import { getLogger } from '@bizr/platform';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { chooseChart, fittingCharts, toAnswerData } from '../ask/answer';
import { loadAskContext, type AskContext } from '../ask/catalog';
import { check } from '../ask/interpret';
import { periodOf, toQuerySpec, type ChartType, type QuestionSpec } from '../ask/interpretation';
import { periodLabel } from '../ask/time';
import { kpiViews, localeFor, tableView, type KpiView, type TableView } from '../ask/view';
import { QueryExecutionError } from '../executor/execute';
import { SemanticError } from '../semantic/graph';
import { compileContext, loadSemanticModel, runQuery } from '../semantic/service';
import type { MemberWorkspace } from '../workspaces/service';
import {
  applyOps,
  DashboardEditError,
  dashboardRangeSchema,
  packTilesFor,
  snapshotSchema,
  tileSchema,
  tileSpec,
  type DashboardRange,
  type DashboardSnapshot,
  type EditOp,
  type Tile,
} from './model';

/**
 * The default dashboard (PRODUCT_SPEC §3, ADR-042): built from the pack, extended when new data makes
 * more tiles possible, edited only through `applyDashboardEdit` (every save is a version, so every
 * change can be undone), and run live for the chosen dates.
 */

type Db = ReturnType<typeof getAppDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
interface WorkspaceRef {
  id: string;
  packId: string;
}

const log = () => getLogger('dashboard');

async function defaultDashboardRow(
  db: Db | Tx,
  workspaceId: string,
): Promise<typeof dashboard.$inferSelect> {
  const [found] = await db
    .select()
    .from(dashboard)
    .where(and(eq(dashboard.workspaceId, workspaceId), eq(dashboard.isDefault, true)));
  if (found) return found;
  const [created] = await db
    .insert(dashboard)
    .values({ workspaceId, name: 'Dashboard', isDefault: true })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  return defaultDashboardRow(db, workspaceId);
}

async function loadSnapshot(
  db: Db | Tx,
  row: typeof dashboard.$inferSelect,
): Promise<DashboardSnapshot> {
  const rows = await db
    .select()
    .from(dashboardTile)
    .where(eq(dashboardTile.dashboardId, row.id))
    .orderBy(asc(dashboardTile.position), asc(dashboardTile.createdAt));
  const tiles: Tile[] = [];
  for (const r of rows) {
    const t = tileSchema.safeParse({
      id: r.id,
      title: r.title,
      spec: r.spec,
      chart: r.chart,
      size: [r.layout.w, r.layout.h],
      fixedDates: r.fixedDates,
      autoGrain: r.options.autoGrain ?? false,
      packKey: r.packKey,
      sourceAnswerId: r.sourceAnswerId,
    });
    if (t.success) tiles.push(t.data);
    else log().warn({ tile: r.id, issues: t.error.issues.slice(0, 3) }, 'unreadable tile skipped');
  }
  return { tiles, removedPackTiles: row.settings.removedPackTiles ?? [] };
}

/** Replaces the dashboard's tiles with `snapshot` and records it as the next version. */
async function saveSnapshot(
  tx: Tx,
  row: typeof dashboard.$inferSelect,
  snapshot: DashboardSnapshot,
  summary: string,
  userId: string | null,
): Promise<number> {
  await tx.delete(dashboardTile).where(eq(dashboardTile.dashboardId, row.id));
  if (snapshot.tiles.length)
    await tx.insert(dashboardTile).values(
      snapshot.tiles.map((t, position) => ({
        id: t.id,
        dashboardId: row.id,
        workspaceId: row.workspaceId,
        title: t.title,
        spec: t.spec,
        chart: t.chart,
        layout: { x: 0, y: 0, w: t.size[0], h: t.size[1] },
        position,
        fixedDates: t.fixedDates,
        packKey: t.packKey,
        options: t.autoGrain ? { autoGrain: true } : {},
        sourceAnswerId: t.sourceAnswerId,
      })),
    );
  const [last] = await tx
    .select({ v: sql<number>`coalesce(max(${dashboardVersion.version}), 0)` })
    .from(dashboardVersion)
    .where(eq(dashboardVersion.dashboardId, row.id));
  const version = Number(last?.v ?? 0) + 1;
  await tx.insert(dashboardVersion).values({
    dashboardId: row.id,
    workspaceId: row.workspaceId,
    version,
    tiles: snapshot,
    summary,
    createdBy: userId,
  });
  const settings: DashboardSettings = {
    ...row.settings,
    removedPackTiles: snapshot.removedPackTiles,
  };
  await tx
    .update(dashboard)
    .set({ settings, updatedAt: new Date() })
    .where(eq(dashboard.id, row.id));
  return version;
}

async function availableMeasures(db: Db | Tx, workspaceId: string) {
  const rows = await db
    .select({ key: metric.key, available: metric.available, reason: metric.unavailableReason })
    .from(metric)
    .where(eq(metric.workspaceId, workspaceId));
  return {
    available: new Set(rows.filter((r) => r.available).map((r) => r.key)),
    reasons: new Map(rows.filter((r) => !r.available).map((r) => [r.key, r.reason])),
  };
}

/**
 * Adds the pack's tiles that the data can show now and that aren't on the dashboard yet (and that
 * the owner didn't remove). Idempotent: safe to run after every import and on every visit.
 */
export async function ensureDefaultDashboard(
  ws: WorkspaceRef,
  userId: string | null = null,
): Promise<{ added: number }> {
  const db = getAppDb();
  return db.transaction(async (tx) => {
    // One generator at a time per workspace (imports and page visits can race).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`dashboard:${ws.id}`}))`);
    const row = await defaultDashboardRow(tx, ws.id);
    const { available } = await availableMeasures(tx, ws.id);
    if (available.size === 0) return { added: 0 };
    const current = await loadSnapshot(tx, row);
    const have = new Set(current.tiles.flatMap((t) => (t.packKey ? [t.packKey] : [])));
    const { tiles } = packTilesFor(
      getPack(ws.packId),
      available,
      new Set([...current.removedPackTiles, ...have]),
    );
    if (tiles.length === 0) {
      if (!row.generatedAt)
        await tx.update(dashboard).set({ generatedAt: new Date() }).where(eq(dashboard.id, row.id));
      return { added: 0 };
    }
    const first = !row.generatedAt;
    await saveSnapshot(
      tx,
      row,
      { ...current, tiles: [...current.tiles, ...tiles] },
      first
        ? 'Built your dashboard'
        : `Added ${tiles.map((t) => `“${t.title}”`).join(', ')} for your new data`,
      userId,
    );
    await tx.update(dashboard).set({ generatedAt: new Date() }).where(eq(dashboard.id, row.id));
    return { added: tiles.length };
  });
}

// --- Edits --------------------------------------------------------------------------------------

/**
 * Checks every question in a set of edits the way Ask checks answers (ids exist, it compiles,
 * measures are available). Returns plain problems, or none.
 */
export async function editProblems(
  member: MemberWorkspace,
  ops: readonly EditOp[],
  ctx?: AskContext,
): Promise<string[]> {
  const specs = ops.flatMap((o) =>
    o.op === 'add_tile' || (o.op === 'update_tile' && o.spec) ? [o.spec!] : [],
  );
  if (specs.length === 0) return [];
  const ask = ctx ?? (await loadAskContext(member));
  const problems: string[] = [];
  for (const spec of specs) {
    const r = await check(
      { kind: 'query', spec, assumptions: [] },
      {
        question: '',
        catalog: ask.catalog,
        model: ask.model,
        compile: compileContext(member),
        pack: getPack(member.workspace.packId),
        tenantSchema: member.workspace.tenantSchema,
        provider: null,
      },
    );
    if (r.interpretation.kind === 'unanswerable') problems.push(r.interpretation.message);
    problems.push(...r.problems);
  }
  return problems;
}

export interface EditResult {
  version: number;
  changes: string[];
  snapshot: DashboardSnapshot;
}

/** Applies edits to the default dashboard after checking them, as a new version. */
export async function applyDashboardEdit(
  member: MemberWorkspace,
  userId: string | null,
  ops: readonly EditOp[],
  options: { newId?: () => string } = {},
): Promise<EditResult> {
  if (ops.length === 0) throw new DashboardEditError('There’s nothing to change.');
  const problems = await editProblems(member, ops);
  if (problems.length) {
    log().warn({ problems }, 'dashboard edit refused');
    throw new DashboardEditError('That change can’t be made to your dashboard.');
  }
  const db = getAppDb();
  return db.transaction(async (tx) => {
    const row = await defaultDashboardRow(tx, member.workspace.id);
    const current = await loadSnapshot(tx, row);
    const { snapshot, changes } = applyOps(current, ops, options.newId);
    const version = await saveSnapshot(tx, row, snapshot, changes.join('; '), userId);
    return { version, changes, snapshot };
  });
}

/** Restores the dashboard as it was before the last change (itself saved as a new version). */
export async function undoDashboardEdit(
  member: MemberWorkspace,
  userId: string | null,
): Promise<{ undone: string }> {
  const db = getAppDb();
  return db.transaction(async (tx) => {
    const row = await defaultDashboardRow(tx, member.workspace.id);
    const versions = await tx
      .select()
      .from(dashboardVersion)
      .where(eq(dashboardVersion.dashboardId, row.id))
      .orderBy(desc(dashboardVersion.version))
      .limit(2);
    const [latest, before] = versions;
    const restored = before ? snapshotSchema.safeParse(before.tiles) : undefined;
    if (!latest || !restored?.success) throw new DashboardEditError('There’s nothing to undo.');
    await saveSnapshot(tx, row, restored.data, `Undid: ${latest.summary}`, userId);
    return { undone: latest.summary };
  });
}

// --- Viewing ------------------------------------------------------------------------------------

export interface TileView {
  id: string;
  title: string;
  chart: ChartType;
  size: [number, number];
  fixedDates: boolean;
  packKey: string | null;
  /** "Sep 2026" when the tile keeps its own dates. */
  datesLabel?: string;
  comparedWith?: string;
  /** Charts that can show this tile (for "change chart"). */
  charts?: ChartType[];
  table?: TableView;
  kpis?: KpiView[];
  error?: string;
}

export interface DashboardView {
  range: DashboardRange;
  rangeLabel: string;
  comparedWith?: string;
  tiles: TileView[];
  /** "Add product costs to see profit and margins." for pack tiles the data can't show yet. */
  unlock: string[];
  canUndo: boolean;
}

const CACHE_MAX = 500;
const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<
  string,
  { at: number; view: Omit<TileView, 'id' | 'title' | 'size' | 'fixedDates' | 'packKey'> }
>();

function cached(key: string) {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_TTL_MS) return undefined;
  cache.delete(key);
  cache.set(key, hit); // most recently used last
  return hit.view;
}
function remember(key: string, view: NonNullable<ReturnType<typeof cached>>) {
  cache.set(key, { at: Date.now(), view });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

/** For tests. */
export function clearTileCache(): void {
  cache.clear();
}

/** The dates the dashboard shows: the request, else the owner's last choice, else the pack's. */
async function rangeFor(
  row: typeof dashboard.$inferSelect,
  packId: string,
  requested?: DashboardRange,
): Promise<DashboardRange> {
  if (requested) return requested;
  const saved = dashboardRangeSchema.safeParse(row.settings.range);
  if (saved.success) return saved.data;
  const d = getPack(packId).dashboard.default_range;
  return { range: { preset: d.preset }, compare: d.compare };
}

/** Runs tiles for a date range, each as the tenant reader, with results cached by data version. */
export async function renderTiles(
  member: MemberWorkspace,
  tiles: readonly Tile[],
  range: DashboardRange,
): Promise<TileView[]> {
  const ws = member.workspace;
  if (tiles.length === 0) return [];
  const db = getAppDb();
  const pack = getPack(ws.packId);
  const cc = compileContext(member);
  const cal = {
    today: cc.today,
    weekStart: cc.weekStart,
    fiscalYearStartMonth: cc.fiscalYearStartMonth,
  };
  const options = {
    pack,
    locale: localeFor(member.settings),
    currency: member.settings.currency,
    fiscalYearStartMonth: cc.fiscalYearStartMonth,
  };
  const [version] = await db
    .select({ dataVersion: workspace.dataVersion })
    .from(workspace)
    .where(eq(workspace.id, ws.id));
  const model = await loadSemanticModel(ws);
  const isSnapshot = (id: string) => model.metrics.get(id)?.snapshot ?? false;

  return Promise.all(
    tiles.map(async (t): Promise<TileView> => {
      const base = {
        id: t.id,
        title: t.title,
        size: t.size,
        fixedDates: t.fixedDates,
        packKey: t.packKey,
      };
      const spec: QuestionSpec = tileSpec(t, range, cal, isSnapshot);
      const key = JSON.stringify([
        ws.id,
        version?.dataVersion ?? 0,
        cc.today,
        spec,
        t.chart,
        options.locale,
      ]);
      const hit = cached(key);
      if (hit) return { ...base, ...hit };
      try {
        const r = await runQuery(member, toQuerySpec(spec, cal), 'dashboard', model);
        const data = toAnswerData(r);
        const own = t.fixedDates ? periodOf(spec.timeRange, cal) : undefined;
        const view = {
          chart: chooseChart(data, spec, t.chart),
          charts: fittingCharts(data),
          table: tableView(data, options),
          kpis: kpiViews(data, options),
          ...(t.fixedDates ? { datesLabel: periodLabel(own) } : {}),
          ...(r.previousPeriod ? { comparedWith: periodLabel(r.previousPeriod) } : {}),
        };
        remember(key, view);
        return { ...base, ...view };
      } catch (err) {
        if (err instanceof SemanticError || err instanceof QueryExecutionError) {
          log().warn({ err, tile: t.id }, 'tile failed');
          return { ...base, chart: t.chart, error: 'Couldn’t load this.' };
        }
        throw err;
      }
    }),
  );
}

export async function dashboardView(
  member: MemberWorkspace,
  requested?: DashboardRange,
): Promise<DashboardView> {
  const ws = member.workspace;
  const db = getAppDb();
  let row = await defaultDashboardRow(db, ws.id);
  if (!row.generatedAt) {
    await ensureDefaultDashboard(ws);
    row = await defaultDashboardRow(db, ws.id);
  }
  const snapshot = await loadSnapshot(db, row);
  const range = await rangeFor(row, ws.packId, requested);
  const tiles = await renderTiles(member, snapshot.tiles, range);

  const { reasons } = await availableMeasures(db, ws.id);
  const removed = new Set(snapshot.removedPackTiles);
  const unlock = [
    ...new Set(
      getPack(ws.packId)
        .dashboard.tiles.filter((t) => !removed.has(t.id))
        .flatMap((t) => t.spec.metrics.map((m) => reasons.get(m)))
        .filter((r): r is string => Boolean(r)),
    ),
  ];
  const versions = await db
    .select({ v: dashboardVersion.version })
    .from(dashboardVersion)
    .where(eq(dashboardVersion.dashboardId, row.id))
    .orderBy(desc(dashboardVersion.version))
    .limit(2);
  const cc = compileContext(member);
  const cal = {
    today: cc.today,
    weekStart: cc.weekStart,
    fiscalYearStartMonth: cc.fiscalYearStartMonth,
  };
  return {
    range,
    rangeLabel: periodLabel(periodOf(range.range, cal)),
    tiles,
    unlock,
    canUndo: versions.length > 1,
  };
}

/** The dates the dashboard is showing (for edit previews). */
export async function currentRange(member: MemberWorkspace): Promise<DashboardRange> {
  const row = await defaultDashboardRow(getAppDb(), member.workspace.id);
  return rangeFor(row, member.workspace.packId);
}

/** Remembers the owner's chosen dates for next time. */
export async function saveDashboardRange(
  member: MemberWorkspace,
  range: DashboardRange,
): Promise<void> {
  const db = getAppDb();
  const row = await defaultDashboardRow(db, member.workspace.id);
  await db
    .update(dashboard)
    .set({ settings: { ...row.settings, range: dashboardRangeSchema.parse(range) } })
    .where(eq(dashboard.id, row.id));
}

/** The current tiles (for edit planning). */
export async function currentDashboard(member: MemberWorkspace): Promise<DashboardSnapshot> {
  const db = getAppDb();
  return loadSnapshot(db, await defaultDashboardRow(db, member.workspace.id));
}

/** Marks the business's records as changed, so cached tiles are run again. */
export async function bumpDataVersion(workspaceId: string): Promise<void> {
  await getAppDb()
    .update(workspace)
    .set({ dataVersion: sql`${workspace.dataVersion} + 1` })
    .where(eq(workspace.id, workspaceId));
}
