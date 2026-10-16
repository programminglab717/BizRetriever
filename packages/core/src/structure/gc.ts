import { getAppDb, getPool, snapshot, workspace } from '@bizr/db';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';

import { defineJob } from '../jobs/define';
import { qualified } from '../sql/ident';

/**
 * `snapshot.gc` (ADR-023): drops snapshot copies past their 30 days. Daily. Each snapshot is its own
 * small transaction, so a re-run just carries on.
 */
export const snapshotGcJob = defineJob<Record<string, never>, { dropped: number }>({
  name: 'snapshot.gc',
  input: z.object({}).strict(),
  initialState: () => ({ dropped: 0 }),
  failureMessage: 'Clearing old backups didn’t finish. It will try again tomorrow.',
  steps: [
    {
      name: 'drop-expired',
      async run({ state }) {
        const db = getAppDb();
        const expired = await db
          .select({
            id: snapshot.id,
            objects: snapshot.objects,
            tenantSchema: workspace.tenantSchema,
          })
          .from(snapshot)
          .innerJoin(workspace, eq(workspace.id, snapshot.workspaceId))
          .where(and(isNull(snapshot.droppedAt), lt(snapshot.expiresAt, new Date())))
          .limit(200);
        let dropped = state.dropped;
        for (const s of expired) {
          const client = await getPool('admin').connect();
          try {
            await client.query('BEGIN');
            for (const o of s.objects)
              await client.query(
                `DROP TABLE IF EXISTS ${qualified(`${s.tenantSchema}_snap`, o.snapshotTable)}`,
              );
            await client.query('COMMIT');
          } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
          } finally {
            client.release();
          }
          await db.update(snapshot).set({ droppedAt: new Date() }).where(eq(snapshot.id, s.id));
          dropped += 1;
        }
        return { state: { dropped } };
      },
    },
  ],
});
