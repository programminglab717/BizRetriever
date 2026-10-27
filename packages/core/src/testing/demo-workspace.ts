import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { getAppDb, user } from '@bizr/db';
import {
  generateDemoDataset,
  generateWholesaleDataset,
  simulateDemo,
  type Simulation,
  type WholesaleTruth,
} from '@bizr/demo-data';
import { getPack } from '@bizr/packs';
import { eq } from 'drizzle-orm';

import { applyChangePlan, loadCatalog } from '../change-plan/apply';
import { planFromPack } from '../change-plan/from-pack';
import { withTenantWriter } from '../executor/write';
import { analyzeFiles } from '../ingestion/analyze';
import { proposeHeuristically } from '../ingestion/heuristic';
import { loadRecords } from '../ingestion/load';
import { materialize } from '../ingestion/materialize';
import { entitySpecs } from '../ingestion/pipeline';
import { bumpDataVersion, ensureDefaultDashboard } from '../dashboard/service';
import { refreshSemanticCatalog } from '../semantic/service';
import { analyzeTenant } from '../tenancy/provision';
import {
  createWorkspace,
  deleteWorkspace,
  getMemberWorkspace,
  type MemberWorkspace,
} from '../workspaces/service';

/**
 * A Fernwood demo workspace loaded the normal way (rules-only data model, no AI), for integration
 * tests and the question evals. Call `dispose()` when done.
 */
export interface DemoWorkspace {
  member: MemberWorkspace;
  ownerId: string;
  sim: Simulation;
  dispose(): Promise<void>;
}

/** Creates a business for `packId` and brings `files` in the normal way, rules only (no AI). */
async function loadFilesAsWorkspace(options: {
  packId: string;
  name: string;
  today: string;
  timezone: string;
  files: { fileName: string; bytes: Uint8Array }[];
}): Promise<{ member: MemberWorkspace; ownerId: string; dispose(): Promise<void> }> {
  const { files, timezone } = options;
  const pack = getPack(options.packId);
  const [u] = await getAppDb()
    .insert(user)
    .values({ name: 'Demo', email: `demo-${crypto.randomUUID()}@example.test` })
    .returning({ id: user.id });
  const ownerId = u!.id;
  const ws = await createWorkspace(ownerId, {
    name: options.name,
    packId: options.packId,
    currency: 'USD',
    timezone,
    dateOrder: 'MDY',
  });
  const member = (await getMemberWorkspace(ws.slug, ownerId))!;
  const tenant = { workspaceId: ws.id, tenantSchema: ws.tenantSchema };

  const analysis = await analyzeFiles(files, { dateOrder: 'MDY', maskPii: true });
  const { proposal } = proposeHeuristically(analysis.profiled, {
    pack,
    dateOrder: 'MDY',
    today: options.today,
  });
  const used = [...new Set(proposal.sources.flatMap((s) => s.targets.map((t) => t.entity)))];
  await applyChangePlan({
    workspace: { id: ws.id, tenantSchema: ws.tenantSchema },
    plan: planFromPack(pack, used),
    origin: 'system',
  });
  const result = materialize(analysis.tables, proposal, entitySpecs(pack), { dateOrder: 'MDY' });
  const catalog = await loadCatalog(ws.id);
  await withTenantWriter(
    tenant,
    'demo load',
    (w) =>
      loadRecords(
        w,
        catalog,
        result,
        files.map(() => crypto.randomUUID()),
      ),
    { timezone },
  );
  await analyzeTenant(ws.tenantSchema);
  await refreshSemanticCatalog(ws);
  await bumpDataVersion(ws.id);
  await ensureDefaultDashboard(ws, ownerId);
  return {
    member,
    ownerId,
    async dispose() {
      await deleteWorkspace(member, ownerId);
      await getAppDb().delete(user).where(eq(user.id, ownerId));
    },
  };
}

function readFiles(dir: string) {
  return readdirSync(dir)
    .filter((f) => f !== 'ground_truth.json')
    .sort()
    .map((fileName) => ({ fileName, bytes: readFileSync(path.join(dir, fileName)) }));
}

export async function loadDemoWorkspace(options: {
  today: string;
  seed?: number;
  timezone?: string;
  name?: string;
  /** False loads the control business (no planted stories). */
  stories?: boolean;
  /** Days of trading before today (default 365). */
  historyDays?: number;
}): Promise<DemoWorkspace> {
  const seed = options.seed ?? 42;
  const dir = mkdtempSync(path.join(tmpdir(), 'fernwood-'));
  try {
    await generateDemoDataset({
      today: options.today,
      seed,
      outDir: dir,
      stories: options.stories ?? true,
      ...(options.historyDays ? { historyDays: options.historyDays } : {}),
    });
    const loaded = await loadFilesAsWorkspace({
      packId: 'retail',
      name: options.name ?? 'Fernwood Home & Gift',
      today: options.today,
      timezone: options.timezone ?? 'America/New_York',
      files: readFiles(dir),
    });
    return {
      ...loaded,
      sim: simulateDemo({
        today: options.today,
        seed,
        stories: options.stories ?? true,
        ...(options.historyDays ? { historyDays: options.historyDays } : {}),
      }),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The Harbour & Pine wholesale demo (M14) loaded the same way, with its answer key. */
export interface WholesaleWorkspace {
  member: MemberWorkspace;
  ownerId: string;
  truth: WholesaleTruth;
  dispose(): Promise<void>;
}

export async function loadWholesaleWorkspace(options: {
  today: string;
  seed?: number;
  name?: string;
}): Promise<WholesaleWorkspace> {
  const dir = mkdtempSync(path.join(tmpdir(), 'harbour-'));
  try {
    const truth = await generateWholesaleDataset({
      today: options.today,
      seed: options.seed ?? 42,
      outDir: dir,
    });
    const loaded = await loadFilesAsWorkspace({
      packId: 'wholesale',
      name: options.name ?? 'Harbour & Pine Supply Co.',
      today: options.today,
      timezone: 'America/New_York',
      files: readFiles(dir),
    });
    return { ...loaded, truth };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
