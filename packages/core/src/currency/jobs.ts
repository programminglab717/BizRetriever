import { z } from 'zod';

import { defineJob } from '../jobs/define';
import { fetchEcbRates } from './ecb';
import { storeRates } from './rates';

/** `fx.daily`: store the ECB's latest reference rates (the last 90 days, so gaps fill in). */
export const fxDailyJob = defineJob<{ date: string }, { stored?: number }>({
  name: 'fx.daily',
  input: z.object({ date: z.iso.date() }).strict(),
  initialState: () => ({}),
  failureMessage: 'Today’s exchange rates couldn’t be fetched. We’ll try again tomorrow.',
  steps: [
    {
      name: 'fetch',
      async run({ state }) {
        if (state.stored !== undefined) return { state };
        return { state: { stored: await storeRates(await fetchEcbRates()) } };
      },
    },
  ],
});
