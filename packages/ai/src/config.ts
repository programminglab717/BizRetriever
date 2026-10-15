import { z } from 'zod';

import type { ModelTier } from './types';

/**
 * AI configuration. Read from the environment by the caller (the platform env module) and passed in,
 * so this package stays free of global state and easy to test.
 */
export const aiConfigSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AI_MODEL_STRONG: z.string().default('claude-opus-5-5'),
  AI_MODEL_STANDARD: z.string().default('claude-sonnet-5-5'),
  AI_MODEL_FAST: z.string().default('claude-haiku-5-5'),
  /** off: always live. record: replay if recorded, else live and record. replay: recordings only. */
  AI_REPLAY_MODE: z.enum(['off', 'record', 'replay']).default('record'),
  AI_RECORDINGS_DIR: z.string().optional(),
  AI_BUDGET_DAILY_USD: z.coerce.number().min(0).default(2),
  AI_BUDGET_MONTHLY_USD: z.coerce.number().min(0).default(15),
});
export type AiConfig = z.infer<typeof aiConfigSchema>;

export function modelFor(config: AiConfig, tier: ModelTier): string {
  return tier === 'strong'
    ? config.AI_MODEL_STRONG
    : tier === 'standard'
      ? config.AI_MODEL_STANDARD
      : config.AI_MODEL_FAST;
}
