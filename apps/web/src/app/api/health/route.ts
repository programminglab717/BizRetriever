import { pingDatabase } from '@bizr/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const database = (await pingDatabase()) ? 'up' : 'down';
  const ok = database === 'up';
  return Response.json(
    { status: ok ? 'ok' : 'degraded', checks: { database } },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
