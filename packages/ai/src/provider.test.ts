import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { MessagesClient } from './anthropic';
import { aiConfigSchema } from './config';
import { createProvider } from './provider';
import {
  AiBudgetExceededError,
  AiInvalidOutputError,
  AiRefusedError,
  AiUnavailableError,
  type AiCallRecord,
  type AiCallSink,
  type GenerateRequest,
} from './types';

const schema = z.object({ answer: z.string(), count: z.number().int() });

function message(
  text: string,
  opts: { stop?: Anthropic.Message['stop_reason']; model?: string } = {},
): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: opts.model ?? 'claude-opus-5-5',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: opts.stop ?? 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 1000,
      output_tokens: 200,
      cache_read_input_tokens: 500,
      cache_creation_input_tokens: 0,
    },
  } as unknown as Anthropic.Message;
}

function fakeClient(responses: Anthropic.Message[]) {
  const calls: Anthropic.MessageStreamParams[] = [];
  const client: MessagesClient = {
    stream(params) {
      calls.push(params);
      const next = responses.shift();
      if (!next) throw new Error('no more fake responses');
      return { finalMessage: () => Promise.resolve(next) };
    },
  };
  return { client, calls };
}

function memorySink(spent = 0) {
  const records: AiCallRecord[] = [];
  const sink: AiCallSink = {
    record: (r) => {
      records.push(r);
      return Promise.resolve();
    },
    spentSince: () => Promise.resolve(spent),
  };
  return { sink, records };
}

const request = (
  overrides: Partial<GenerateRequest<z.infer<typeof schema>>> = {},
): GenerateRequest<z.infer<typeof schema>> => ({
  task: 'test_task',
  promptVersion: 'test_task@v1',
  tier: 'strong',
  system: 'You answer with JSON.',
  messages: [{ role: 'user', content: 'How many?' }],
  schema,
  maxTokens: 1000,
  ...overrides,
});

const config = (overrides: Record<string, unknown> = {}) =>
  aiConfigSchema.parse({ ANTHROPIC_API_KEY: 'test-key', ...overrides });
const tempDir = () => mkdtempSync(path.join(tmpdir(), 'ai-rec-'));

describe('AI provider', () => {
  it('returns schema-checked data, logs cost, and records then replays', async () => {
    const dir = tempDir();
    const { client, calls } = fakeClient([message('{"answer":"three","count":3}')]);
    const { sink, records } = memorySink();
    const provider = createProvider({
      config: config({ AI_REPLAY_MODE: 'record' }),
      sink,
      recordingsDir: dir,
      client,
    });

    const first = await provider.generate(request());
    expect(first).toMatchObject({
      data: { answer: 'three', count: 3 },
      replayed: false,
      model: 'claude-opus-5-5',
    });
    // 1000×$4 + 200×$20 + 500×$0.20 per million
    expect(first.costUsd).toBeCloseTo(0.0081, 6);
    expect(calls[0]!.output_config?.format?.type).toBe('json_schema');
    expect(calls[0]!.system).toEqual([
      { type: 'text', text: 'You answer with JSON.', cache_control: { type: 'ephemeral' } },
    ]);

    const second = await provider.generate(request());
    expect(second).toMatchObject({
      data: { answer: 'three', count: 3 },
      replayed: true,
      costUsd: 0,
    });
    expect(calls).toHaveLength(1);
    expect(records.map((r) => r.status)).toEqual(['ok', 'replayed']);
  });

  it('repairs invalid output once by feeding back the validation errors', async () => {
    const { client, calls } = fakeClient([
      message('{"answer":"x","count":"lots"}'),
      message('{"answer":"x","count":7}'),
    ]);
    const provider = createProvider({
      config: config({ AI_REPLAY_MODE: 'off' }),
      sink: memorySink().sink,
      recordingsDir: tempDir(),
      client,
    });
    const result = await provider.generate(request());
    expect(result.data.count).toBe(7);
    const retry = calls[1]!.messages;
    expect(retry.at(-1)!.content).toMatch(/count/);
    expect(result.usage.inputTokens).toBe(2000);
  });

  it('gives up after one repair', async () => {
    const { client } = fakeClient([message('not json'), message('{"answer":1}')]);
    const { sink, records } = memorySink();
    const provider = createProvider({
      config: config({ AI_REPLAY_MODE: 'off' }),
      sink,
      recordingsDir: tempDir(),
      client,
    });
    await expect(provider.generate(request())).rejects.toThrow(AiInvalidOutputError);
    expect(records.at(-1)!.status).toBe('invalid_output');
  });

  it('retries a refusal once on the standard tier, then reports it', async () => {
    const { client, calls } = fakeClient([
      message('', { stop: 'refusal' }),
      message('{"answer":"ok","count":1}', { model: 'claude-sonnet-5-5' }),
    ]);
    const provider = createProvider({
      config: config({ AI_REPLAY_MODE: 'off' }),
      sink: memorySink().sink,
      recordingsDir: tempDir(),
      client,
    });
    const result = await provider.generate(request());
    expect(calls.map((c) => c.model)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5']);
    expect(result.model).toBe('claude-sonnet-5-5');

    const twice = fakeClient([message('', { stop: 'refusal' }), message('', { stop: 'refusal' })]);
    const p2 = createProvider({
      config: config({ AI_REPLAY_MODE: 'off' }),
      sink: memorySink().sink,
      recordingsDir: tempDir(),
      client: twice.client,
    });
    await expect(p2.generate(request())).rejects.toThrow(AiRefusedError);
  });

  it('doubles max_tokens when output is cut off', async () => {
    const { client, calls } = fakeClient([
      message('{"answer":', { stop: 'max_tokens' }),
      message('{"answer":"a","count":1}'),
    ]);
    const provider = createProvider({
      config: config({ AI_REPLAY_MODE: 'off' }),
      sink: memorySink().sink,
      recordingsDir: tempDir(),
      client,
    });
    await provider.generate(request());
    expect(calls.map((c) => c.max_tokens)).toEqual([1000, 2000]);
  });

  it('never calls the API in replay mode, even with a key', async () => {
    const { client, calls } = fakeClient([message('{"answer":"a","count":1}')]);
    const provider = createProvider({
      config: config({ AI_REPLAY_MODE: 'replay' }),
      sink: memorySink().sink,
      recordingsDir: tempDir(),
      client,
    });
    await expect(provider.generate(request())).rejects.toThrow(AiUnavailableError);
    expect(calls).toHaveLength(0);
  });

  it('is unavailable without an API key', async () => {
    const provider = createProvider({
      config: aiConfigSchema.parse({ AI_REPLAY_MODE: 'off' }),
      sink: memorySink().sink,
      recordingsDir: tempDir(),
    });
    await expect(provider.generate(request())).rejects.toThrow(AiUnavailableError);
  });

  it('blocks live calls once the budget is spent', async () => {
    const { client, calls } = fakeClient([message('{"answer":"a","count":1}')]);
    const { sink, records } = memorySink(2.5);
    const provider = createProvider({
      config: config({ AI_REPLAY_MODE: 'off', AI_BUDGET_DAILY_USD: 2 }),
      sink,
      recordingsDir: tempDir(),
      client,
    });
    await expect(provider.generate(request())).rejects.toThrow(AiBudgetExceededError);
    expect(calls).toHaveLength(0);
    expect(records.at(-1)!.status).toBe('budget_blocked');
  });

  it('treats a recording with an out-of-date shape as missing', async () => {
    const dir = tempDir();
    const first = fakeClient([message('{"answer":"a","count":1}')]);
    await createProvider({
      config: config({ AI_REPLAY_MODE: 'record' }),
      sink: memorySink().sink,
      recordingsDir: dir,
      client: first.client,
    }).generate(request());
    const second = fakeClient([]);
    const strictSchema = z.object({
      answer: z.string(),
      count: z.number().int(),
      extra: z.string(),
    });
    await expect(
      createProvider({
        config: config({ AI_REPLAY_MODE: 'replay' }),
        sink: memorySink().sink,
        recordingsDir: dir,
        client: second.client,
      }).generate({
        ...request(),
        schema: strictSchema,
      }),
    ).rejects.toThrow(AiUnavailableError);
  });
});
