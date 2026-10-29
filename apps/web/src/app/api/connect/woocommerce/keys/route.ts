import { receiveWooKeys, wooEnabled } from '@bizr/core/connections';
import { getLogger } from '@bizr/platform';

import { kickJobs } from '@/lib/imports';
import { getJobQueue } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

/**
 * The store posts its new read-only key here (server to server, M18). Kept only with the sealed
 * token we gave the store, and only once the key works on that store.
 */
export async function POST(request: Request): Promise<Response> {
  // i18n-skip: server to server
  if (!wooEnabled()) return Response.json({ error: 'Not found' }, { status: 404 });
  const text = await request.text();
  // i18n-skip: server to server
  if (text.length > 8_000) return Response.json({ error: 'Too large' }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // i18n-skip: server to server
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
  try {
    const ok = await receiveWooKeys(body, await getJobQueue());
    // i18n-skip: server to server
    if (!ok) return Response.json({ error: 'Not accepted' }, { status: 400 });
    kickJobs();
    return Response.json({ ok: true });
  } catch (err) {
    getLogger('woocommerce').error({ err }, 'keys callback failed');
    // i18n-skip: server to server
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}
