import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { closePools, getAppDb, insight, localStorage, setStorageForTests, user } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDefaultRegistry } from '../jobs';
import { JobQueue } from '../jobs/queue';
import { listUserWorkspaces } from '../workspaces/service';
import { DEMO_SHOP_NAME, demoToday, finishDemoImport, removeDemoShops, startDemoShop } from '.';

/** M8: "Try the demo shop" makes a fresh Fernwood for today and brings it in the normal way. */
const hasDb = await databaseAvailable();

describe.skipIf(!hasDb)('demo shop (integration)', () => {
  let owner: string;
  let queue: JobQueue;

  beforeAll(async () => {
    setStorageForTests(localStorage(mkdtempSync(path.join(tmpdir(), 'bizr-demo-uploads-'))));
    const [u] = await getAppDb()
      .insert(user)
      .values({ name: 'Demo Owner', email: `demo-shop-${crypto.randomUUID()}@example.test` })
      .returning({ id: user.id });
    owner = u!.id;
    queue = await JobQueue.start({ registry: createDefaultRegistry(), supervise: false });
  }, 60_000);

  afterAll(async () => {
    if (owner) {
      await removeDemoShops(owner);
      await getAppDb().delete(user).where(eq(user.id, owner));
    }
    await queue?.stop();
    setStorageForTests(undefined);
    await closePools();
  });

  it('imports today’s demo files and finds the stories, and a reset starts afresh', async () => {
    const first = await startDemoShop({ userId: owner, queue });
    expect(first.member.workspace).toMatchObject({ name: DEMO_SHOP_NAME, isDemo: true });
    const done = await finishDemoImport({
      member: first.member,
      userId: owner,
      runId: first.runId,
      queue,
    });
    expect(done.run.status).toBe('done');

    const found = await getAppDb()
      .select({ ruleId: insight.ruleId, level: insight.level, text: insight.text })
      .from(insight)
      .where(eq(insight.workspaceId, first.member.workspace.id));
    // Generated for today, so the stories are current whatever the date.
    expect(found.find((f) => f.ruleId === 'stockout_risk')).toMatchObject({ level: 'urgent' });
    expect(found.map((f) => f.ruleId)).toEqual(
      expect.arrayContaining([
        'dead_stock',
        'customer_slipping',
        'margin_squeeze',
        'overdue_payments',
      ]),
    );
    expect(demoToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Resetting replaces the old demo shop rather than adding another.
    const second = await startDemoShop({ userId: owner, queue });
    const mine = await listUserWorkspaces(owner);
    expect(mine.map((m) => m.workspace.id)).toEqual([second.member.workspace.id]);
  }, 300_000);
});
