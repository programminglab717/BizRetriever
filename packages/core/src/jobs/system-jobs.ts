import { z } from 'zod';

import { defineJob } from './define';

/**
 * A do-nothing multi-step job. Used to verify the job system end to end (tests, health checks)
 * in both runner modes. It has a repeating middle step so it exercises checkpoints and yielding.
 */
export const noopJob = defineJob({
  name: 'system.noop',
  input: z.object({
    ticks: z.number().int().min(0).max(1_000),
    tickMs: z.number().int().min(0).max(5_000).default(0),
  }),
  initialState: () => ({ ticksDone: 0, log: [] as string[] }),
  steps: [
    {
      name: 'start',
      run: async ({ state }) => ({ state: { ...state, log: [...state.log, 'start'] } }),
    },
    {
      name: 'tick',
      run: async ({ input, state, reportProgress }) => {
        if (state.ticksDone >= input.ticks) return { state };
        if (input.tickMs > 0) await new Promise((r) => setTimeout(r, input.tickMs));
        const ticksDone = state.ticksDone + 1;
        await reportProgress('ticking', Math.round((ticksDone / Math.max(1, input.ticks)) * 100));
        return { state: { ...state, ticksDone }, again: ticksDone < input.ticks };
      },
    },
    {
      name: 'finish',
      run: async ({ state }) => ({ state: { ...state, log: [...state.log, 'finish'] } }),
    },
  ],
});
