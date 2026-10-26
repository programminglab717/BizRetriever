/**
 * `pnpm --filter @bizr/worker run tenant-logins` — gives every business its own database login
 * (ADR-055), or refreshes their passwords after `TENANT_LOGIN_SECRET` changes, then takes the shared
 * broker out of those businesses' roles. Idempotent. `--keep-broker` leaves the broker's memberships
 * (only while switching over a running system).
 *
 * Rotating the secret: set the new value everywhere the app runs, then run this once.
 */
import { ensureTenantLogin, revokeBroker, tenantLoginsEnabled } from '@bizr/core/tenancy';
import { closePools, getAppDb, getPool, workspace } from '@bizr/db';
import { eq } from 'drizzle-orm';

async function main() {
  if (!tenantLoginsEnabled())
    throw new Error('Set TENANT_LOGIN_SECRET first (openssl rand -hex 32).');
  const keepBroker = process.argv.includes('--keep-broker');
  const rows = await getAppDb()
    .select({ schema: workspace.tenantSchema })
    .from(workspace)
    .where(eq(workspace.status, 'active'));
  let done = 0;
  for (const { schema } of rows) {
    await ensureTenantLogin(schema);
    if (!keepBroker) {
      const client = await getPool('admin').connect();
      try {
        await revokeBroker(client, schema);
      } finally {
        client.release();
      }
    }
    done += 1;
  }
  console.log(
    `${done} business login(s) ready${keepBroker ? '' : '; the shared broker no longer reaches them'}.`,
  );
  await closePools();
}

main().catch(async (err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  await closePools().catch(() => {});
  process.exit(1);
});
