import { AiBudgetExceededError } from '@bizr/ai';
import { getPack } from '@bizr/packs';
import { describe, expect, it } from 'vitest';

import { FakeProvider, fixtureCatalog, fixtureCompile, fixtureModel } from './fixtures';
import { interpret, UNCLEAR_MESSAGE, type InterpretInput } from './interpret';
import type { Interpretation, QuestionSpec } from './interpretation';

const pack = getPack('retail');

function input(question: string, extra: Partial<InterpretInput> = {}): InterpretInput {
  return {
    question,
    catalog: fixtureCatalog(),
    model: fixtureModel,
    compile: fixtureCompile,
    pack,
    tenantSchema: 't_abcdefghij',
    provider: null,
    ...extra,
  };
}

const salesSpec = (over: Partial<QuestionSpec> = {}): QuestionSpec => ({
  metrics: ['net_sales'],
  dimensions: [],
  filters: [],
  having: [],
  timeRange: { preset: 'last_month' },
  ...over,
});
const query = (spec: QuestionSpec, assumptions: string[] = []): Interpretation => ({
  kind: 'query',
  spec,
  assumptions,
});

describe('interpret', () => {
  it('answers clear questions with the rules, without calling the AI', async () => {
    const provider = new FakeProvider({});
    const out = await interpret(input('How much did I sell last month?', { provider }));
    expect(out).toMatchObject({ origin: 'rules', aiCalls: 0 });
    expect(provider.calls).toHaveLength(0);
  });

  it('sends unclear questions to the AI with values inside the data block', async () => {
    const answer = query(salesSpec({ dimensions: [{ time: 'week' }] }), [
      'I took “doing” to mean net sales.',
    ]);
    const provider = new FakeProvider({ interpret_question: [answer] });
    const out = await interpret(input('how have we been doing lately week to week', { provider }));
    expect(out).toMatchObject({ origin: 'ai', aiCalls: 1, interpretation: answer });
    const call = provider.calls[0]!;
    expect(call).toMatchObject({ task: 'interpret_question', tier: 'standard' });
    expect(call.system).not.toContain('Sage Stoneware Mug');
    expect(call.cachedContext?.join('')).not.toContain('Sage Stoneware Mug');
    const user = call.messages[0]!.content;
    const data = user.slice(user.indexOf('<workspace_data>'), user.indexOf('</workspace_data>'));
    expect(data).toContain('Sage Stoneware Mug');
    expect(data).toContain('relations');
  });

  it('repairs once, then escalates to the strong tier', async () => {
    const bad = query(salesSpec({ metrics: ['made_up_measure'] }));
    const good = query(salesSpec());
    const provider = new FakeProvider({ interpret_question: [bad, bad, good] });
    const out = await interpret(input('how have we been doing lately', { provider }));
    expect(out).toMatchObject({ origin: 'ai', aiCalls: 3 });
    expect(provider.calls.map((c) => c.tier)).toEqual(['standard', 'standard', 'strong']);
    expect(provider.calls[1]!.messages[0]!.content).toContain('unknown measure');
  });

  it('fixes value spelling and rejects values that aren’t in the records', async () => {
    const provider = new FakeProvider({
      interpret_question: [
        query(
          salesSpec({
            filters: [{ field: 'sale.channel', op: 'eq', values: ['Website'] }],
          }),
        ),
      ],
    });
    const out = await interpret(input('how is the web shop doing lately', { provider }));
    expect(out.interpretation).toMatchObject({
      spec: { filters: [{ field: 'sale.channel', values: ['online_store'] }] },
    });

    const wrong = new FakeProvider({
      interpret_question: [
        query(salesSpec({ filters: [{ field: 'product.category', op: 'eq', values: ['Hats'] }] })),
        query(salesSpec()),
      ],
    });
    await interpret(input('how are hats doing lately', { provider: wrong }));
    expect(wrong.calls[1]!.messages[0]!.content).toContain("isn't one of the values");
  });

  it('drops assumptions with numbers or jargon', async () => {
    const provider = new FakeProvider({
      interpret_question: [
        query(salesSpec(), [
          'Sales were about 4,000 last month.',
          'I grouped the rows by column.',
          'I took “doing” to mean net sales.',
        ]),
      ],
    });
    const out = await interpret(input('how have we been doing lately', { provider }));
    expect(out.interpretation).toMatchObject({
      assumptions: ['I took “doing” to mean net sales.'],
    });
  });

  it('turns measures the data can’t support into a missing-data answer', async () => {
    const provider = new FakeProvider({
      interpret_question: [query(salesSpec({ metrics: ['gross_profit'] }))],
    });
    const out = await interpret(
      input('how much did we really make lately', {
        provider,
        catalog: fixtureCatalog({ gross_profit: 'Add product costs to see profit.' }),
      }),
    );
    expect(out.interpretation).toEqual({
      kind: 'unanswerable',
      reason: 'missing_data',
      missing: ['Gross profit'],
      message: 'Add product costs to see profit.',
    });
  });

  it('never asks twice in a row', async () => {
    const clarify: Interpretation = {
      kind: 'clarify',
      question: 'Do you mean by spend or by orders?',
      options: [
        { label: 'By spend', spec: salesSpec(), assumptions: [] },
        { label: 'By orders', spec: salesSpec({ metrics: ['order_count'] }), assumptions: [] },
      ],
    };
    const provider = new FakeProvider({ interpret_question: [clarify] });
    const out = await interpret(
      input('the good ones i mean', {
        provider,
        history: [{ question: 'who are my best customers', interpretation: clarify }],
      }),
    );
    expect(out.interpretation).toMatchObject({
      kind: 'query',
      spec: { metrics: ['net_sales'] },
      assumptions: ['I took it to mean “by spend”.'],
    });
  });

  it('checks SQL with the validator', async () => {
    const sql = (text: string): Interpretation => ({
      kind: 'sql',
      sql: text,
      rationale: 'needs weekdays',
      assumptions: [],
    });
    const provider = new FakeProvider({
      interpret_question: [
        sql('SELECT * FROM pg_catalog.pg_roles'),
        sql('SELECT * FROM sales; DROP TABLE sales'),
        sql('SELECT extract(isodow FROM sale_date) AS d, count(*) FROM sales GROUP BY 1'),
      ],
    });
    const out = await interpret(input('What were my best days of the week?', { provider }));
    expect(out).toMatchObject({ origin: 'ai', aiCalls: 3, interpretation: { kind: 'sql' } });
    expect(provider.calls[1]!.messages[0]!.content).toContain('rejected');
  });

  it('falls back to the rules’ best guess when the AI isn’t available', async () => {
    const provider = new FakeProvider({
      interpret_question: [new AiBudgetExceededError('over budget', 'Out of AI budget')],
    });
    const out = await interpret(input('show me sales last month for my lovely shop', { provider }));
    expect(out.origin).toBe('rules_fallback');
    expect(out.interpretation).toMatchObject({ kind: 'query', spec: { metrics: ['net_sales'] } });
    if (out.interpretation.kind === 'query')
      expect(out.interpretation.assumptions.at(-1)).toMatch(
        /wasn’t sure what you meant by “lovely”/,
      );
  });

  it('asks to rephrase when nothing understood it', async () => {
    const out = await interpret(input('hello there', { aiMode: 'never' }));
    expect(out).toMatchObject({
      origin: 'none',
      interpretation: { kind: 'unanswerable', reason: 'unclear', message: UNCLEAR_MESSAGE },
    });
  });
});
