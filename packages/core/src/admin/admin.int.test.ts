import { aiCall, closePools, getAppDb } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { adminOverview, evalBaselines, isAdmin } from '.';

/** M8 admin page numbers: spend, AI failures and latency, from the control-plane logs. */
const hasDb = await databaseAvailable();

describe.skipIf(!hasDb)('admin overview (integration)', () => {
  const task = `admin_test_${crypto.randomUUID().slice(0, 8)}`;
  afterAll(async () => {
    await getAppDb().delete(aiCall).where(eq(aiCall.task, task));
    await closePools();
  });

  it('counts AI calls by outcome and reads the eval baselines', async () => {
    const base = { task, promptVersion: `${task}@v1`, tier: 'fast', model: 'test', costUsd: '0' };
    const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
    await getAppDb()
      .insert(aiCall)
      .values([
        { ...base, ...usage, status: 'ok', latencyMs: 100 },
        { ...base, ...usage, status: 'invalid_output', latencyMs: 300 },
        { ...base, ...usage, status: 'unavailable', latencyMs: 1 },
      ]);
    const o = await adminOverview();
    expect(o.byTask.find((t) => t.task === task)).toMatchObject({
      calls: 3,
      ok: 1,
      invalid: 1,
      blocked: 1,
    });
    expect(Number(o.spend.monthUsd)).toBeGreaterThanOrEqual(0);
    expect(evalBaselines().map((b) => b.suite)).toEqual(
      expect.arrayContaining(['ingest', 'questions']),
    );
    expect(isAdmin('nobody@example.test')).toBe(false);
  });
});
