import { z } from 'zod';

import { defineJob } from '../jobs/define';
import { connectionsToCheck, syncConnection, type SyncOutcome } from './service';

/**
 * `connections.sync`: check one linked source now ("Update now"). `connections.daily`: check every
 * linked source once a day, one per call until the time budget is used, so a drain call can stop
 * between sources and pick up where it left off.
 */

export const connectionSyncJob = defineJob<{ connectionId: string }, { outcome?: SyncOutcome }>({
  name: 'connections.sync',
  input: z.object({ connectionId: z.uuid() }).strict(),
  initialState: () => ({}),
  failureMessage: 'We couldn’t check this source just now. We’ll try again later.',
  steps: [
    {
      name: 'sync',
      async run({ input, state, enqueue }) {
        if (state.outcome) return { state };
        return { state: { outcome: await syncConnection(input.connectionId, enqueue) } };
      },
    },
  ],
});

interface DailyState {
  remaining: string[] | null;
  done: number;
}

export const connectionsDailyJob = defineJob<{ date: string }, DailyState>({
  name: 'connections.daily',
  input: z.object({ date: z.iso.date() }).strict(),
  initialState: () => ({ remaining: null, done: 0 }),
  failureMessage: 'The daily check of linked sources didn’t finish. It will try again tomorrow.',
  steps: [
    {
      name: 'list',
      async run({ state }) {
        return { state: { ...state, remaining: await connectionsToCheck() } };
      },
    },
    {
      name: 'check-each',
      async run({ state, deadline, enqueue, log }) {
        const remaining = [...(state.remaining ?? [])];
        let done = state.done;
        while (remaining.length > 0 && Date.now() < deadline) {
          const id = remaining.shift()!;
          try {
            await syncConnection(id, enqueue);
          } catch (err) {
            // One source's trouble mustn't stop the others.
            log.error({ err, connectionId: id }, 'daily check failed for a source');
          }
          done += 1;
        }
        return { state: { remaining, done }, again: remaining.length > 0 };
      },
    },
  ],
});
