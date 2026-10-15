import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { modelFor, type AiConfig } from './config';
import { costUsd } from './pricing';
import {
  AiError,
  AiInvalidOutputError,
  AiRefusedError,
  type ChatMessage,
  type GenerateRequest,
  type ModelTier,
  type Usage,
} from './types';

/** The slice of the SDK we use, so tests can substitute a fake. */
export interface MessagesClient {
  stream(params: Anthropic.MessageStreamParams): { finalMessage(): Promise<Anthropic.Message> };
}

export interface LiveResult<T> {
  data: T;
  model: string;
  usage: Usage;
  costUsd: number;
}

const ZERO: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function addUsage(a: Usage, m: Anthropic.Message): Usage {
  return {
    inputTokens: a.inputTokens + (m.usage.input_tokens ?? 0),
    outputTokens: a.outputTokens + (m.usage.output_tokens ?? 0),
    cacheReadTokens: a.cacheReadTokens + (m.usage.cache_read_input_tokens ?? 0),
    cacheWriteTokens: a.cacheWriteTokens + (m.usage.cache_creation_input_tokens ?? 0),
  };
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
 * One structured-output call to Claude (ADR-010): streamed (no HTTP timeouts on long outputs),
 * schema-constrained via `output_config.format`, validated again with Zod, and repaired once with the
 * validation errors fed back. A refusal on one tier is retried once on the standard tier.
 */
export async function generateLive<T>(
  client: MessagesClient,
  config: AiConfig,
  request: GenerateRequest<T>,
): Promise<LiveResult<T>> {
  let usage = ZERO;
  let tier: ModelTier = request.tier;
  let model = modelFor(config, tier);
  let maxTokens = request.maxTokens;
  const messages: ChatMessage[] = [...request.messages];
  const format = zodOutputFormat(request.schema as never);

  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: request.system },
    ...(request.cachedContext ?? []).map((text) => ({ type: 'text' as const, text })),
  ];
  // Cache the stable prefix (system + reference blocks); volatile content comes after.
  systemBlocks[systemBlocks.length - 1] = {
    ...systemBlocks[systemBlocks.length - 1]!,
    cache_control: { type: 'ephemeral' },
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    let message: Anthropic.Message;
    try {
      message = await client
        .stream({
          model,
          max_tokens: maxTokens,
          system: systemBlocks,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          output_config: {
            format: { type: 'json_schema', schema: format.schema },
            ...(request.effort ? { effort: request.effort } : {}),
          },
        })
        .finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        throw new AiError(
          `Anthropic API error ${err.status ?? ''}: ${err.message}`,
          'Our AI helper is unavailable right now. Please try again in a minute.',
        );
      }
      throw err;
    }
    usage = addUsage(usage, message);
    const cost = () => costUsd(model, usage);

    if (message.stop_reason === 'refusal') {
      if (tier !== 'standard') {
        tier = 'standard';
        model = modelFor(config, tier);
        continue;
      }
      throw Object.assign(
        new AiRefusedError('Model refused', 'Our AI helper couldn’t help with that.'),
        { usage, cost: cost() },
      );
    }
    if (message.stop_reason === 'max_tokens') {
      if (maxTokens < 64_000) {
        maxTokens = Math.min(64_000, maxTokens * 2);
        continue;
      }
      throw Object.assign(
        new AiInvalidOutputError(
          'Output truncated at max_tokens',
          'That was too big for our AI helper. Try a smaller file.',
        ),
        { usage, cost: cost() },
      );
    }

    const text = textOf(message);
    let parsed: unknown;
    let problem: string;
    try {
      parsed = JSON.parse(text);
      const result = request.schema.safeParse(parsed);
      if (result.success) return { data: result.data, model, usage, costUsd: cost() };
      problem = result.error.issues
        .slice(0, 10)
        .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n');
    } catch {
      problem = '- the output was not valid JSON';
    }
    if (attempt >= 1) {
      throw Object.assign(
        new AiInvalidOutputError(
          `Output failed validation:\n${problem}`,
          'Our AI helper gave an answer we couldn’t use.',
        ),
        { usage, cost: cost() },
      );
    }
    // One repair round: show the model exactly what was wrong.
    messages.push({ role: 'assistant', content: text });
    messages.push({
      role: 'user',
      content: `That output did not match the required format:\n${problem}\nReturn the corrected JSON only.`,
    });
  }
  throw new AiInvalidOutputError(
    'No usable output',
    'Our AI helper gave an answer we couldn’t use.',
  );
}

export function createAnthropicClient(apiKey: string): MessagesClient {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 10 * 60_000 });
  return client.messages;
}
