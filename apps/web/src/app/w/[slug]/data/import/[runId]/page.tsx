import { getRunView, IngestionRequestError } from '@bizr/core/ingestion';
import { notFound } from 'next/navigation';

import { ImportRun } from '@/components/import/import-run';
import { BUSY_STATUSES, kickJobs, toImportView } from '@/lib/imports';
import { requireWorkspace } from '@/lib/session';

export default async function ImportRunPage({
  params,
}: {
  params: Promise<{ slug: string; runId: string }>;
}) {
  const { slug, runId } = await params;
  const member = await requireWorkspace(slug);
  if (!/^[0-9a-f-]{36}$/.test(runId)) notFound();
  let view;
  try {
    view = await getRunView(member, runId);
  } catch (err) {
    if (err instanceof IngestionRequestError) notFound();
    throw err;
  }
  if (BUSY_STATUSES.has(view.run.status)) kickJobs();
  return <ImportRun slug={slug} initial={toImportView(view, member)} />;
}
