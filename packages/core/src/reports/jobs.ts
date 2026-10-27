import { getAppDb, reportSchedule } from '@bizr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { defineJob } from '../jobs/define';
import { sendDueReports } from './service';

interface State {
  remaining: string[] | null;
  sent: number;
}

/** Once a day (M15): every business with a report due today, one at a time, checkpointed. */
export const reportsDailyJob = defineJob<{ date: string }, State>({
  name: 'reports.daily',
  input: z.object({ date: z.iso.date() }).strict(),
  initialState: () => ({ remaining: null, sent: 0 }),
  failureMessage: 'Today’s scheduled reports didn’t all go. They’ll be tried again tomorrow.',
  steps: [
    {
      name: 'list-workspaces',
      async run({ state }) {
        const rows = await getAppDb()
          .selectDistinct({ id: reportSchedule.workspaceId })
          .from(reportSchedule)
          .where(eq(reportSchedule.paused, false));
        return { state: { ...state, remaining: rows.map((r) => r.id) } };
      },
    },
    {
      name: 'send-each',
      async run({ state, deadline, log }) {
        const remaining = [...(state.remaining ?? [])];
        let sent = state.sent;
        while (remaining.length > 0 && Date.now() < deadline) {
          const id = remaining.shift()!;
          try {
            sent += await sendDueReports(id);
          } catch (err) {
            log.error({ err, workspaceId: id }, 'scheduled reports failed for a workspace');
          }
        }
        return { state: { remaining, sent }, again: remaining.length > 0 };
      },
    },
  ],
});
