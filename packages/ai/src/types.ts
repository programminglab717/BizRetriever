import type { z } from 'zod';

export type ModelTier = 'strong' | 'standard' | 'fast';
export type Effort = 'low' | 'medium' | 'high';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateRequest<T> {
  /** Task name, e.g. "propose_data_model" (for logs, cost tracking and replay keys). */
  task: string;
  /** Immutable prompt version, e.g. "propose_data_model@v1". */
  promptVersion: string;
  tier: ModelTier;
  effort?: Effort;
  /** Stable instructions. Never contains uploaded content (AI_DESIGN §2). */
  system: string;
  /** Stable reference blocks (pack primer, catalog) placed before the volatile messages; cached. */
  cachedContext?: string[];
  /** Volatile content. Uploaded data appears here only inside <workspace_data> blocks. */
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  maxTokens: number;
  workspaceId?: string | null;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface GenerateResult<T> {
  data: T;
  model: string;
  usage: Usage;
  costUsd: number;
  latencyMs: number;
  /** True when served from a replay recording (no API call, no cost). */
  replayed: boolean;
}

export interface LLMProvider {
  generate<T>(request: GenerateRequest<T>): Promise<GenerateResult<T>>;
}

export type AiCallStatus =
  'ok' | 'replayed' | 'error' | 'refused' | 'invalid_output' | 'budget_blocked' | 'unavailable';

/** One row in app.ai_call. */
export interface AiCallRecord {
  workspaceId: string | null;
  task: string;
  promptVersion: string;
  tier: ModelTier;
  model: string;
  status: AiCallStatus;
  latencyMs: number;
  usage: Usage;
  costUsd: number;
  error?: string;
}

/**
 * Where AI calls are recorded and how much has been spent. Implemented outside this package (the AI
 * layer never touches the database, ADR-002).
 */
export interface AiCallSink {
  record(call: AiCallRecord): Promise<void>;
  /** Total USD spent on live calls since `since`. */
  spentSince(since: Date): Promise<number>;
}

/** Base for AI errors. `userMessage` is safe to show; callers fall back to deterministic paths. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
  ) {
    super(message);
  }
}

/** No API key configured, or replay-only mode with no recording. */
export class AiUnavailableError extends AiError {}
/** The daily or monthly spend cap would be exceeded (ADR-027). */
export class AiBudgetExceededError extends AiError {}
/** The model declined. */
export class AiRefusedError extends AiError {}
/** The model's output didn't match the schema, even after a retry. */
export class AiInvalidOutputError extends AiError {}
