import { closePools } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { segmentsToText } from '../narration';
import { setGoal } from '../planning/goals';
import { loadDemoWorkspace, type DemoWorkspace } from '../testing/demo-workspace';
import { askQuestion } from './service';

/** M12 (ADR-061): questions about what's ahead, answered in Ask by the planning engine. */
const hasDb = await databaseAvailable();
const noAi = { provider: null, aiMode: 'never' as const };

describe.skipIf(!hasDb)('Ask about what’s ahead (integration)', () => {
  let demo: DemoWorkspace;
  const ask = (question: string) => askQuestion(demo.member, demo.ownerId, { question }, noAi);

  beforeAll(async () => {
    demo = await loadDemoWorkspace({ today: '2026-10-13', name: 'Fernwood Ahead Test' });
  }, 240_000);
  afterAll(async () => {
    await demo?.dispose();
    await closePools();
  });

  it('estimates next month with a range, week by week, saying how', async () => {
    const r = await ask('How much will I sell next month?');
    expect(r).toMatchObject({ kind: 'estimate', origin: 'rules' });
    const text = segmentsToText(r.content.headline!);
    expect(text).toMatch(
      /^About \$[\d,]+ for [A-Z][a-z]+ \d{4}, likely between \$[\d,]+ and \$[\d,]+\.$/,
    );
    expect(r.content.data!.rows.length).toBeGreaterThanOrEqual(4);
    expect(r.content.data!.columns[1]).toMatchObject({
      format: 'money',
      label: 'Estimated net sales',
    });
    expect(r.content.steps!.join(' ')).toMatch(/range/);
    expect(r.content.assumptions).toContain(
      'These are estimates from your own sales history, not promises.',
    );
  });

  it('includes what’s already recorded for this month', async () => {
    const r = await ask('How much will I sell this month?');
    expect(segmentsToText(r.content.headline!)).toMatch(/already recorded/);
  });

  it('answers goal questions, with or without a goal', async () => {
    const none = await ask('Am I on track for my goal?');
    expect(segmentsToText(none.content.headline!)).toMatch(/haven’t set a monthly goal/);
    await setGoal(demo.member, demo.ownerId, 'net_sales', '12000');
    const g = await ask('Will I hit my sales target this month?');
    const text = segmentsToText(g.content.headline!);
    expect(text).toMatch(/^Net sales: (reached|ahead|on track|behind|too early to say)\./);
    expect(text).toMatch(/so far: \$[\d,.]+ of \$12,000\.00/);
  });

  it('lists what to reorder', async () => {
    const r = await ask('What should I reorder?');
    expect(r.kind).toBe('estimate');
    expect(r.content.data!.columns.map((c) => c.label)).toEqual([
      'Product',
      'Supplier',
      'Days of stock left',
      'Order about',
    ]);
    expect(segmentsToText(r.content.headline!)).toMatch(/\d+ products? needs? ordering/);
  });

  it('says plainly what it can’t estimate, and leaves questions about the past alone', async () => {
    const m = await ask('Will my margin go up next month?');
    expect(m.kind).toBe('unanswerable');
    expect(m.content.unanswerable!.message).toMatch(
      /^I can estimate net sales, orders and items sold ahead/,
    );
    const past = await ask('How much did I sell last month?');
    expect(past.kind).toBe('query');
  });
});
