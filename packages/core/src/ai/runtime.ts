import path from 'node:path';

import { aiConfigSchema, createProvider, type AiCallSink, type LLMProvider } from '@bizr/ai';
import { aiCall, getAppDb } from '@bizr/db';
import { currentCorrelationId, findRepoRoot, getEnv, getLogger } from '@bizr/platform';
import { and, gte, inArray, sql } from 'drizzle-orm';

/** Records AI calls in app.ai_call and answers "how much have we spent?" for the budget guard. */
export const dbAiCallSink: AiCallSink = {
  async record(call) {
    try {
      await getAppDb()
        .insert(aiCall)
        .values({
          workspaceId: call.workspaceId,
          task: call.task,
          promptVersion: call.promptVersion,
          tier: call.tier,
          model: call.model,
          status: call.status,
          latencyMs: call.latencyMs,
          inputTokens: call.usage.inputTokens,
          outputTokens: call.usage.outputTokens,
          cacheReadTokens: call.usage.cacheReadTokens,
          cacheWriteTokens: call.usage.cacheWriteTokens,
          costUsd: call.costUsd.toFixed(6),
          error: call.error ?? null,
          correlationId: currentCorrelationId() ?? null,
        });
    } catch (err) {
      getLogger('ai').error({ err }, 'failed to record ai_call');
    }
  },
  async spentSince(since) {
    const [row] = await getAppDb()
      .select({ total: sql<string>`coalesce(sum(${aiCall.costUsd}), 0)` })
      .from(aiCall)
      .where(
        and(
          gte(aiCall.createdAt, since),
          inArray(aiCall.status, ['ok', 'refused', 'invalid_output', 'error']),
        ),
      );
    return Number(row?.total ?? 0);
  },
};

let provider: LLMProvider | undefined;

/**
 * The application's AI provider. In tests (NODE_ENV=test) it is ALWAYS replay-only, whatever the env
 * says: tests and CI must never call the live API (ADR-027).
 */
export function getAiProvider(): LLMProvider {
  if (provider) return provider;
  const env = getEnv();
  const config = aiConfigSchema.parse({
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    AI_MODEL_STRONG: env.AI_MODEL_STRONG,
    AI_MODEL_STANDARD: env.AI_MODEL_STANDARD,
    AI_MODEL_FAST: env.AI_MODEL_FAST,
    AI_REPLAY_MODE: env.NODE_ENV === 'test' ? 'replay' : env.AI_REPLAY_MODE,
    AI_BUDGET_DAILY_USD: env.AI_BUDGET_DAILY_USD,
    AI_BUDGET_MONTHLY_USD: env.AI_BUDGET_MONTHLY_USD,
  });
  const recordingsDir = env.AI_RECORDINGS_DIR ?? path.join(findRepoRoot(), 'evals', 'recordings');
  provider = createProvider({ config, sink: dbAiCallSink, recordingsDir });
  return provider;
}

/** Test helper. */
export function setAiProviderForTests(p: LLMProvider | undefined): void {
  provider = p;
}
