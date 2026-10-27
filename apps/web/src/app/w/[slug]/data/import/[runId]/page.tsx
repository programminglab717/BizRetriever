import { getRunView, IngestionRequestError } from '@bizr/core/ingestion';
import { canChange } from '@bizr/core/workspaces';
import { notFound } from 'next/navigation';

import { ImportRun } from '@/components/import/import-run';
import { PageHeader } from '@/components/shell/page-header';
import { ViewOnlyNote } from '@/components/shell/view-only';
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
  if (!canChange(member.role) && ['review', 'merge_review'].includes(view.run.status))
    return (
      <div className="grid gap-6">
        <PageHeader title="Bringing in files" />
        <ViewOnlyNote>
          The owner or a member needs to check these files before they come in.
        </ViewOnlyNote>
      </div>
    );
  return <ImportRun slug={slug} initial={toImportView(view, member)} />;
}
