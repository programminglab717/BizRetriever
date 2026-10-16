import { closePools, dashboardTile, getAppDb } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { segmentsToText } from '../narration';
import { runQuery } from '../semantic/service';
import { loadDemoWorkspace, type DemoWorkspace } from '../testing/demo-workspace';
import { resolvePreset } from './time';
import {
  askQuestion,
  AskError,
  getConversation,
  pinAnswer,
  setAnswerFeedback,
  suggestedQuestions,
  unpinTile,
} from './service';

/** Ask end to end on the demo data, with the AI off (rules only). */
const hasDb = await databaseAvailable();
const TZ = 'America/New_York';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const noAi = { provider: null, aiMode: 'never' as const };

describe.skipIf(!hasDb)('Ask service (integration)', () => {
  let demo: DemoWorkspace;
  beforeAll(async () => {
    demo = await loadDemoWorkspace({ today, timezone: TZ, name: 'Fernwood Ask Test' });
  }, 120_000);
  afterAll(async () => {
    await demo?.dispose();
    await closePools();
  });

  it('answers a question with numbers from the query', async () => {
    const r = await askQuestion(
      demo.member,
      demo.ownerId,
      { question: 'How much did I sell last month?' },
      noAi,
    );
    expect(r).toMatchObject({ kind: 'query', origin: 'rules' });
    const cal = { today, weekStart: 1, fiscalYearStartMonth: 1 };
    const direct = await runQuery(
      demo.member,
      { metrics: ['net_sales'], period: resolvePreset('last_month', cal)! },
      'system',
    );
    const value = String(direct.rows[0]!.m_net_sales);
    expect(r.content.data!.rows[0]!.m_net_sales).toBe(value);
    const headline = segmentsToText(r.content.headline!);
    const shown = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
      value as unknown as number,
    );
    expect(headline).toContain(shown);
    expect(r.content.chart).toBe('kpi');
    expect(r.content.steps!.join(' ')).toMatch(/Net sales:/);
    expect(r.content.details!.sql).toMatch(/^WITH/);
  }, 30_000);

  it('asks which “best” is meant, then answers the choice', async () => {
    const q = await askQuestion(
      demo.member,
      demo.ownerId,
      { question: 'Who are my best customers?' },
      noAi,
    );
    expect(q.kind).toBe('clarify');
    expect(q.content.clarify!.options).toEqual(['How much they spend', 'How often they order']);
    const a = await askQuestion(
      demo.member,
      demo.ownerId,
      {
        question: '',
        conversationId: q.conversationId,
        choice: { answerId: q.answerId, option: 0 },
      },
      noAi,
    );
    expect(a).toMatchObject({ kind: 'query', question: 'How much they spend' });
    expect(a.content.assumptions[0]).toBe('I took it to mean “how much they spend”.');
    expect(a.content.data!.rows.length).toBeGreaterThan(1);
    expect(a.content.chart).toBe('bar_horizontal');
  }, 30_000);

  it('follows up in the same conversation', async () => {
    const first = await askQuestion(
      demo.member,
      demo.ownerId,
      { question: 'sales by channel last month' },
      noAi,
    );
    const next = await askQuestion(
      demo.member,
      demo.ownerId,
      { question: 'what about etsy', conversationId: first.conversationId },
      noAi,
    );
    expect(next.kind).toBe('query');
    expect(next.content.steps).toContain('Only where sold through is Etsy.');
    const convo = await getConversation(demo.member, first.conversationId);
    expect(convo.map((t) => t.question)).toEqual([
      'sales by channel last month',
      'what about etsy',
    ]);
  });

  it('stores feedback and pins answers to the dashboard', async () => {
    const r = await askQuestion(
      demo.member,
      demo.ownerId,
      { question: 'top 5 products by profit this year' },
      noAi,
    );
    await setAnswerFeedback(demo.member, r.answerId, -1, 'wrong_period');
    const tileId = await pinAnswer(demo.member, r.answerId);
    const [tile] = await getAppDb()
      .select()
      .from(dashboardTile)
      .where(eq(dashboardTile.id, tileId));
    expect(tile).toMatchObject({ position: 0, fixedDates: false, chart: r.content.chart });
    const convo = await getConversation(demo.member, r.conversationId);
    expect(convo[0]).toMatchObject({ feedback: -1, pinned: true });
    await unpinTile(demo.member, tileId);
    expect((await getConversation(demo.member, r.conversationId))[0]!.pinned).toBe(false);
  }, 30_000);

  it('refuses conversations and answers from elsewhere', async () => {
    await expect(
      askQuestion(
        demo.member,
        demo.ownerId,
        { question: 'sales', conversationId: crypto.randomUUID() },
        noAi,
      ),
    ).rejects.toBeInstanceOf(AskError);
    await expect(setAnswerFeedback(demo.member, crypto.randomUUID(), 1)).rejects.toBeInstanceOf(
      AskError,
    );
  });

  it('suggests answerable example questions', () => {
    const chips = suggestedQuestions(demo.member, new Set(['net_sales', 'days_of_cover']));
    expect(chips.map((c) => c.group)).toEqual([
      'Sales',
      'Products',
      'Stock',
      'Customers',
      'Sales',
      'Sales',
    ]);
  });
});
