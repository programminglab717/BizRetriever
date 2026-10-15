import { getRunView, IngestionRequestError } from '@bizr/core/ingestion';

import { BUSY_STATUSES, kickJobs, toImportView } from '@/lib/imports';
import { workspaceForApi } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Polled by the import screens every couple of seconds while work is in progress. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; runId: string }> },
): Promise<Response> {
  const { slug, runId } = await params;
  const member = await workspaceForApi(slug);
  if (!member || !/^[0-9a-f-]{36}$/.test(runId))
    return Response.json({ error: 'Not found' }, { status: 404 });
  try {
    const view = await getRunView(member, runId);
    if (BUSY_STATUSES.has(view.run.status)) kickJobs();
    return Response.json(toImportView(view, member), { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    if (err instanceof IngestionRequestError)
      return Response.json({ error: 'Not found' }, { status: 404 });
    throw err;
  }
}
