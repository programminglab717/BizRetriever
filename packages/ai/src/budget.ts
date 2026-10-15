import { AiBudgetExceededError, type AiCallSink } from './types';

const START_OF_DAY = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const START_OF_MONTH = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Hard spend caps (ADR-027), checked before every live call. Days and months are UTC. */
export async function assertWithinBudget(
  sink: AiCallSink,
  limits: { dailyUsd: number; monthlyUsd: number },
  now: Date = new Date(),
): Promise<void> {
  const [today, month] = await Promise.all([
    sink.spentSince(START_OF_DAY(now)),
    sink.spentSince(START_OF_MONTH(now)),
  ]);
  if (today >= limits.dailyUsd || month >= limits.monthlyUsd) {
    throw new AiBudgetExceededError(
      `AI budget reached (today $${today.toFixed(2)} of $${limits.dailyUsd}, month $${month.toFixed(2)} of $${limits.monthlyUsd})`,
      'Our AI helper has reached its limit for now. Your data and dashboard still work.',
    );
  }
}
