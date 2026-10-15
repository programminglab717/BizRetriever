import type { Usage } from './types';

/**
 * USD per million tokens. Source: Anthropic pricing as of 2026-10 (claude-api skill, cached
 * 2026-10-06). Update when prices change; unknown models are costed at the most expensive rate so the
 * spend guard errs on the safe side.
 */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
  /** 5-minute cache writes cost 1.25× input. */
  cacheWrite: number;
}

const PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  // Haiku 5.5 prices apply to prompts up to 100K tokens; ours are far smaller.
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};
const FALLBACK: Price = { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 };

export function costUsd(model: string, usage: Usage): number {
  const p = PRICES[model] ?? FALLBACK;
  const cost =
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.cacheWrite) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function knownPrice(model: string): boolean {
  return model in PRICES;
}
