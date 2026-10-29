import { listRuns } from '@bizr/core/ingestion';
import { listChanges } from '@bizr/core/structure';
import { msg } from '@bizr/i18n/translate';

import { ChangeHistory, type HistoryItem } from '@/components/history/change-history';
import { PageHeader } from '@/components/shell/page-header';
import { getT } from '@/lib/i18n';
import { requireWorkspace } from '@/lib/session';

/**
 * Change history (PRODUCT_SPEC Journey 6): changes to how the data is organised and updates from
 * files, newest first. Each says who, when and what, with Undo where it's possible.
 */
export default async function HistoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const member = await requireWorkspace(slug);
  const t = await getT();
  const [changes, runs] = await Promise.all([listChanges(member), listRuns(member, 50)]);
  const items: HistoryItem[] = [
    ...changes
      .filter((c) => c.origin !== 'ingestion')
      .map((c): HistoryItem => ({
        kind: 'structure',
        key: `v${c.version}`,
        at: c.at.toISOString(),
        by: c.by,
        lines: c.steps,
        destructive: c.destructive,
        undone: c.undone,
        version: c.version,
        canUndo: c.canUndo,
      })),
    ...runs
      .filter((r) => r.status === 'done')
      .map((r): HistoryItem => ({
        kind: 'import',
        key: r.id,
        at: (r.finishedAt ?? r.createdAt).toISOString(),
        by: null,
        lines: [
          r.kind === 'reupload'
            ? msg('Updated your data from newer files')
            : msg('Brought in your files'),
        ],
        destructive: false,
        undone: r.undoneAt !== null,
        runId: r.id,
        canUndo: r.kind === 'reupload' && r.undoneAt === null,
      })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('Change history')}
        description={t(
          'Changes to what you track and updates from your files. You can undo the latest change to what you track, and any update from files.',
        )}
      />
      <ChangeHistory slug={slug} items={items} />
    </div>
  );
}
