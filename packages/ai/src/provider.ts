import { createAnthropicClient, generateLive, type MessagesClient } from './anthropic';
import { assertWithinBudget } from './budget';
import { modelFor, type AiConfig } from './config';
import { loadRecording, saveRecording } from './replay';
import {
  AiBudgetExceededError,
  AiInvalidOutputError,
  AiRefusedError,
  AiUnavailableError,
  type AiCallSink,
  type AiCallStatus,
  type GenerateRequest,
  type GenerateResult,
  type LLMProvider,
  type Usage,
} from './types';

const ZERO: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export interface ProviderOptions {
  config: AiConfig;
  sink: AiCallSink;
  recordingsDir: string;
  /** Injected for tests; defaults to the real SDK when an API key is configured. */
  client?: MessagesClient;
  now?: () => Date;
}

/**
 * The application's AI entry point: replay → budget check → live call → record, with every call
 * logged to the sink (CLAUDE.md, Observability).
 */
export function createProvider(options: ProviderOptions): LLMProvider {
  const { config, sink, recordingsDir } = options;
  let client = options.client;

  return {
    async generate<T>(request: GenerateRequest<T>): Promise<GenerateResult<T>> {
      const started = Date.now();
      const log = async (
        status: AiCallStatus,
        model: string,
        usage: Usage,
        cost: number,
        error?: string,
      ) => {
        await sink.record({
          workspaceId: request.workspaceId ?? null,
          task: request.task,
          promptVersion: request.promptVersion,
          tier: request.tier,
          model,
          status,
          latencyMs: Date.now() - started,
          usage,
          costUsd: cost,
          ...(error ? { error } : {}),
        });
      };

      if (config.AI_REPLAY_MODE !== 'off') {
        const rec = loadRecording(recordingsDir, request);
        const parsed = rec ? request.schema.safeParse(rec.data) : undefined;
        if (rec && parsed?.success) {
          await log('replayed', rec.model, ZERO, 0);
          return {
            data: parsed.data,
            model: rec.model,
            usage: rec.usage,
            costUsd: 0,
            latencyMs: Date.now() - started,
            replayed: true,
          };
        }
        if (config.AI_REPLAY_MODE === 'replay') {
          await log('unavailable', modelFor(config, request.tier), ZERO, 0, 'no recording');
          throw new AiUnavailableError(
            `No AI recording for ${request.task} (replay mode)`,
            'Our AI helper is offline right now.',
          );
        }
      }

      if (!client) {
        if (!config.ANTHROPIC_API_KEY) {
          await log('unavailable', modelFor(config, request.tier), ZERO, 0, 'no API key');
          throw new AiUnavailableError(
            'ANTHROPIC_API_KEY is not set',
            'Our AI helper isn’t switched on yet.',
          );
        }
        client = createAnthropicClient(config.ANTHROPIC_API_KEY);
      }

      try {
        await assertWithinBudget(
          sink,
          { dailyUsd: config.AI_BUDGET_DAILY_USD, monthlyUsd: config.AI_BUDGET_MONTHLY_USD },
          options.now?.(),
        );
      } catch (err) {
        if (err instanceof AiBudgetExceededError)
          await log('budget_blocked', modelFor(config, request.tier), ZERO, 0, err.message);
        throw err;
      }

      try {
        const live = await generateLive(client, config, request);
        await log('ok', live.model, live.usage, live.costUsd);
        if (config.AI_REPLAY_MODE === 'record') {
          saveRecording(recordingsDir, request, {
            model: live.model,
            usage: live.usage,
            data: live.data,
          });
        }
        return { ...live, latencyMs: Date.now() - started, replayed: false };
      } catch (err) {
        const e = err as Error & { usage?: Usage; cost?: number };
        const status: AiCallStatus =
          err instanceof AiRefusedError
            ? 'refused'
            : err instanceof AiInvalidOutputError
              ? 'invalid_output'
              : 'error';
        await log(status, modelFor(config, request.tier), e.usage ?? ZERO, e.cost ?? 0, e.message);
        throw err;
      }
    },
  };
}
