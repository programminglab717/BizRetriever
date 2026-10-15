import {
  AiUnavailableError,
  type GenerateRequest,
  type GenerateResult,
  type LLMProvider,
} from '@bizr/ai';
import { getPack } from '@bizr/packs';
import { beforeAll, describe, expect, it } from 'vitest';

import { validateTemplate } from '../narration';
import { proposeDataModel, refineWithDryRun, reviseDataModel } from './ai-proposal';
import { analyzeFiles, type Analysis } from './analyze';
import { applyCorrections, applyEffect, answerToCorrection } from './corrections';
import type { MaterializeResult } from './materialize';
import type { ModelProposal } from './proposal';
import { deterministicSummary, summarizeProposal } from './summary';

/** In-memory provider: answers each task from a queue, records every request. Never calls the API. */
class FakeProvider implements LLMProvider {
  readonly calls: GenerateRequest<unknown>[] = [];
  /** Task → queued answers (output data, or an Error to throw). */
  constructor(private readonly answers: Record<string, unknown[]>) {}
  generate<T>(request: GenerateRequest<T>): Promise<GenerateResult<T>> {
    this.calls.push(request);
    const next = this.answers[request.task]?.shift();
    if (next === undefined) return Promise.reject(new Error(`unexpected call to ${request.task}`));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({
      data: request.schema.parse(next),
      model: 'fake',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsd: 0,
      latencyMs: 0,
      replayed: false,
    });
  }
}

const pack = getPack('retail');
const settings = { currency: 'USD', dateOrder: 'MDY' as const, today: '2026-10-13' };
const csv = (fileName: string, text: string) => ({
  fileName,
  bytes: new TextEncoder().encode(text),
});

let known: Analysis;
let unknown: Analysis;
beforeAll(async () => {
  known = await analyzeFiles(
    [
      csv(
        'stock list.csv',
        'SKU,Product,Price,Cost,In stock\nM1,Sage Mug,18,6,25\nM2,Oat Mug,18,6,12\nV1,Bud Vase,15,5,8\nV2,Tall Vase,22,8,3\nC1,Candle,12,4,40\n',
      ),
    ],
    { dateOrder: 'MDY', maskPii: true },
  );
  unknown = await analyzeFiles(
    [
      csv(
        'bank.csv',
        'When,Who,How much\n03/02/2026,Rent,1200\n03/05/2026,Electric,85.20\n03/09/2026,Packaging,140\n03/15/2026,Postage,62.75\n03/20/2026,Insurance,40\n',
      ),
    ],
    { dateOrder: 'MDY', maskPii: true },
  );
});

const expenseProposal = (entity = 'expense'): ModelProposal => ({
  sources: [
    {
      sourceId: 'f0:0:0',
      decision: 'map',
      rowRules: [],
      targets: [
        {
          entity,
          grain: 'row',
          fields: [
            {
              field: 'expense_date',
              source: { kind: 'column', column: 0 },
              rules: [],
              confidence: 0.9,
            },
            {
              field: 'description',
              source: { kind: 'column', column: 1 },
              rules: [],
              confidence: 0.8,
            },
            { field: 'amount', source: { kind: 'column', column: 2 }, rules: [], confidence: 0.9 },
          ],
        },
      ],
    },
  ],
  dedupe: [],
  assumptions: [
    {
      id: 'bank',
      about: 'bank.csv',
      text: 'Each line in “bank.csv” looks like a business expense.',
      confidence: 0.8,
    },
  ],
  questions: [],
});

describe('proposeDataModel', () => {
  it('skips the AI when the rules recognise every table', async () => {
    const provider = new FakeProvider({});
    const out = await proposeDataModel(known.profiled, { pack, settings, provider });
    expect(out.origin).toBe('heuristic');
    expect(provider.calls).toHaveLength(0);
    expect(out.proposal.sources[0]!.decision).toBe('map');
  });

  it('asks the AI about tables the rules don’t understand', async () => {
    const provider = new FakeProvider({ propose_data_model: [expenseProposal()] });
    const out = await proposeDataModel(unknown.profiled, { pack, settings, provider });
    expect(out.origin).toBe('ai');
    expect(out.proposal.sources[0]!.targets[0]!.entity).toBe('expense');

    const req = provider.calls[0]!;
    expect(req.tier).toBe('strong');
    expect(req.promptVersion).toBe('propose_data_model@v1');
    // Uploaded content only ever appears inside the delimited data block, never in the system prompt.
    expect(req.system).not.toContain('Electric');
    const user = req.messages[0]!.content;
    const block = user.slice(user.indexOf('<workspace_data>'), user.indexOf('</workspace_data>'));
    expect(block).toContain('Electric');
    expect(user.replace(block, '')).not.toContain('Electric');
  });

  it('repairs an invalid AI proposal once', async () => {
    const provider = new FakeProvider({
      propose_data_model: [expenseProposal('bank_line')],
      revise_data_model: [{ proposal: expenseProposal(), changeSummary: [] }],
    });
    const out = await proposeDataModel(unknown.profiled, { pack, settings, provider });
    expect(out.origin).toBe('ai');
    expect(provider.calls.map((c) => c.task)).toEqual(['propose_data_model', 'revise_data_model']);
    expect(provider.calls[1]!.messages[0]!.content).toContain('unknown record type');
  });

  it('falls back to the rules when the AI stays invalid', async () => {
    const provider = new FakeProvider({
      propose_data_model: [expenseProposal('bank_line')],
      revise_data_model: [{ proposal: expenseProposal('bank_line'), changeSummary: [] }],
    });
    const out = await proposeDataModel(unknown.profiled, { pack, settings, provider });
    expect(out.origin).toBe('heuristic');
    expect(out.note).toMatch(/validation/);
  });

  it('falls back to the rules when the AI is unavailable', async () => {
    const provider = new FakeProvider({
      propose_data_model: [
        new AiUnavailableError('no key', 'Our AI helper isn’t switched on yet.'),
      ],
    });
    const out = await proposeDataModel(unknown.profiled, { pack, settings, provider });
    expect(out.origin).toBe('heuristic');
    expect(out.userNote).toBe('Our AI helper isn’t switched on yet.');
  });

  it('asks for a repair when the AI uses jargon', async () => {
    const jargon = expenseProposal();
    jargon.assumptions[0]!.text = 'Column 2 is the amount field.';
    const provider = new FakeProvider({
      propose_data_model: [jargon],
      revise_data_model: [{ proposal: expenseProposal(), changeSummary: [] }],
    });
    const out = await proposeDataModel(unknown.profiled, { pack, settings, provider });
    expect(provider.calls).toHaveLength(2);
    expect(out.proposal.assumptions[0]!.text).toMatch(/business expense/);
  });
});

describe('reviseDataModel', () => {
  it('keeps the owner’s corrections even if the AI undoes them', async () => {
    const base = expenseProposal();
    const corrections = [
      {
        effect: {
          kind: 'unmap_field' as const,
          sourceId: 'f0:0:0',
          entity: 'expense',
          field: 'description',
        },
        label: 'Don’t bring in “Who”.',
      },
    ];
    const provider = new FakeProvider({
      revise_data_model: [
        { proposal: base, changeSummary: ['We now read “Who” as the supplier.'] },
      ],
    });
    const out = await reviseDataModel(
      {
        proposal: base,
        sources: unknown.profiled,
        ownerRequest: 'Who is the supplier',
        corrections,
      },
      { pack, settings, provider },
    );
    expect(out.revised).toBe(true);
    const fields = out.proposal.sources[0]!.targets[0]!.fields.map((f) => f.field);
    expect(fields).not.toContain('description');
    expect(out.changes).toEqual(['We now read “Who” as the supplier.']);
    expect(out.proposal.assumptions.at(-1)!.text).toBe('Don’t bring in “Who”.');
    // The owner's words go in their own block, the locked decision inside the data block.
    const user = provider.calls[0]!.messages[0]!.content;
    expect(user).toContain('<owner_request>');
  });

  it('describes the changes itself when the AI summary uses jargon', async () => {
    const after = expenseProposal();
    after.sources[0]!.targets[0]!.fields.pop();
    after.sources[0]!.targets[0]!.fields.push({
      field: 'amount',
      source: { kind: 'column', column: 2 },
      rules: [{ rule: 'parse_number', decimalSeparator: '.' }],
      confidence: 1,
    });
    const provider = new FakeProvider({
      revise_data_model: [{ proposal: after, changeSummary: ['Changed the amount column parse.'] }],
    });
    const out = await reviseDataModel(
      { proposal: expenseProposal(), sources: unknown.profiled, ownerRequest: 'fix amounts' },
      { pack, settings, provider },
    );
    expect(out.changes).toEqual(['In “bank.csv”, we changed how we read the amount.']);
  });

  it('leaves the proposal alone when the AI is unavailable', async () => {
    const provider = new FakeProvider({
      revise_data_model: [new AiUnavailableError('budget', 'Our AI helper is resting for today.')],
    });
    const out = await reviseDataModel(
      { proposal: expenseProposal(), sources: unknown.profiled, ownerRequest: 'x' },
      { pack, settings, provider },
    );
    expect(out.revised).toBe(false);
    expect(out.userNote).toBe('Our AI helper is resting for today.');
  });
});

describe('refineWithDryRun', () => {
  const resultWith = (unreadable: number): MaterializeResult => ({
    entities: new Map(),
    skipped: [],
    issues: Array.from({ length: unreadable }, (_, i) => ({
      code: 'unreadable_value' as const,
      entity: 'expense',
      field: 'expense_date',
      sourceId: 'f0:0:0',
      fileName: 'bank.csv',
      sheet: 'bank',
      row: i + 2,
      message: 'couldn’t read “x” as a date',
    })),
    stats: {
      sources: [
        {
          sourceId: 'f0:0:0',
          fileName: 'bank.csv',
          sheet: 'bank',
          rowsIn: 10,
          recordsOut: {},
          skipped: 0,
        },
      ],
      entities: {},
      references: [],
    },
  });

  it('revises while the dry run finds problems, keeping only improvements', async () => {
    const fixed = expenseProposal();
    fixed.sources[0]!.targets[0]!.fields[0]!.rules = [{ rule: 'parse_date', order: 'DMY' }];
    const provider = new FakeProvider({
      revise_data_model: [
        { proposal: fixed, changeSummary: ['Dates in “bank” are now read day-first.'] },
      ],
    });
    const runs: ModelProposal[] = [];
    const out = await refineWithDryRun(
      expenseProposal(),
      unknown.profiled,
      { pack, settings, provider },
      (p) => {
        runs.push(p);
        return resultWith(p.sources[0]!.targets[0]!.fields[0]!.rules.length ? 0 : 6);
      },
    );
    expect(out.rounds).toBe(1);
    expect(out.problems).toEqual([]);
    expect(out.changes).toEqual(['Dates in “bank” are now read day-first.']);
    expect(provider.calls[0]!.messages[0]!.content).toContain('couldn');
  });

  it('does nothing when the dry run is clean', async () => {
    const provider = new FakeProvider({});
    const out = await refineWithDryRun(
      expenseProposal(),
      unknown.profiled,
      { pack, settings, provider },
      () => resultWith(1),
    );
    expect(out.rounds).toBe(0);
    expect(provider.calls).toHaveLength(0);
  });
});

describe('corrections', () => {
  it('answers a question with its option’s effect', () => {
    const p = expenseProposal();
    p.questions.push({
      id: 'dates',
      text: 'Are the dates in “bank” day-first?',
      about: 'dates',
      options: [
        {
          id: 'yes',
          label: 'Yes',
          effect: { kind: 'set_date_order', sourceIds: ['f0:0:0'], order: 'DMY' },
        },
        { id: 'no', label: 'No', effect: { kind: 'none' } },
      ],
      defaultOption: 'no',
    });
    const c = answerToCorrection(p, 'dates', 'yes')!;
    const out = applyCorrections(p, [c], pack);
    expect(out.questions).toEqual([]);
    expect(out.sources[0]!.targets[0]!.fields[0]!.rules).toEqual([
      { rule: 'parse_date', order: 'DMY' },
    ]);
    expect(out.assumptions.at(-1)).toMatchObject({
      text: 'Are the dates in “bank” day-first? Yes.',
      confidence: 1,
    });
  });

  it('maps a column to a different detail and frees it elsewhere', () => {
    const out = applyEffect(
      expenseProposal(),
      { kind: 'map_column', sourceId: 'f0:0:0', entity: 'expense', field: 'category', column: 1 },
      pack,
    );
    const fields = out.sources[0]!.targets[0]!.fields;
    expect(fields.map((f) => f.field)).toEqual(['expense_date', 'amount', 'category']);
  });

  it('drops a dedupe group the owner says is different', () => {
    const p = expenseProposal();
    p.dedupe = [
      { entity: 'customer', clusters: [{ canonical: 'Bloom & Co', variants: ['BLOOM & CO LTD'] }] },
    ];
    const out = applyEffect(
      p,
      { kind: 'drop_dedupe', entity: 'customer', canonical: 'Bloom & Co' },
      pack,
    );
    expect(out.dedupe).toEqual([]);
  });

  it('ignores a table on request', () => {
    const out = applyEffect(expenseProposal(), { kind: 'ignore_source', sourceId: 'f0:0:0' }, pack);
    expect(out.sources[0]).toMatchObject({ decision: 'ignore', targets: [] });
  });
});

describe('summarizeProposal', () => {
  const facts = {
    facts: {
      product_count: { kind: 'count' as const, value: 95, one: 'product', other: 'products' },
      sale_count: { kind: 'count' as const, value: 5571, one: 'sale', other: 'sales' },
      file_count: { kind: 'count' as const, value: 6, one: 'file', other: 'files' },
      question_count: { kind: 'count' as const, value: 2, one: 'thing', other: 'things' },
    },
    meanings: [],
  };

  it('uses the AI’s template when it passes the checks', async () => {
    const provider = new FakeProvider({
      summarize_proposal: [
        { template: 'Your {{file_count}} hold {{product_count}} and {{sale_count}}.' },
      ],
    });
    const out = await summarizeProposal(facts, expenseProposal(), { provider });
    expect(out).toEqual({
      template: 'Your {{file_count}} hold {{product_count}} and {{sale_count}}.',
      origin: 'ai',
    });
    expect(provider.calls[0]!.tier).toBe('fast');
  });

  it('rejects numbers the AI wrote itself', async () => {
    const provider = new FakeProvider({
      summarize_proposal: [{ template: 'We found 95 products and {{sale_count}}.' }],
    });
    const out = await summarizeProposal(facts, expenseProposal(), { provider });
    expect(out.origin).toBe('template');
  });

  it('falls back when the AI is unavailable, and the fallback is always valid', async () => {
    const provider = new FakeProvider({ summarize_proposal: [new AiUnavailableError('x', 'y')] });
    const out = await summarizeProposal(facts, expenseProposal(), { provider });
    expect(out.origin).toBe('template');
    expect(out.template).toBe(
      'We found {{product_count}} and {{sale_count}} in your {{file_count}}. Please check {{question_count}} below.',
    );
    expect(validateTemplate(deterministicSummary(facts.facts), Object.keys(facts.facts))).toEqual(
      [],
    );
  });
});
