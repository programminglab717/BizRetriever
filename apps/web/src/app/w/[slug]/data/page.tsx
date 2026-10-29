import { listConnections } from '@bizr/core/connections';
import { listRuns } from '@bizr/core/ingestion';
import { listRecordTypes } from '@bizr/core/records';
import { canChange } from '@bizr/core/workspaces';
import { Download, FileUp, History } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { msg } from '@bizr/i18n/translate';

import { DataChat } from '@/components/data/data-chat';
import { LinkedSources } from '@/components/data/linked-sources';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getT } from '@/lib/i18n';
import { requireWorkspace } from '@/lib/session';

const STATUS: Record<string, string> = {
  analyzing: msg('Working on it'),
  review: msg('Waiting for you to check'),
  revising: msg('Updating'),
  applying: msg('Setting up'),
  merge_review: msg('Waiting for you to check the changes'),
  merging: msg('Updating your data'),
  done: msg('Brought in'),
  failed: msg('Didn’t finish'),
  cancelled: msg('Stopped'),
};

const count = new Intl.NumberFormat('en-US');
const when = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

const CONNECTED: Record<string, string> = {
  shopify: msg('Your Shopify store'),
  quickbooks: 'QuickBooks',
  xero: 'Xero',
  square: 'Square',
  woocommerce: msg('Your WooCommerce store'),
};

export default async function DataPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ do?: string | string[]; connected?: string }>;
}) {
  const { slug } = await params;
  const { do: asked, connected } = await searchParams;
  const prefill = (Array.isArray(asked) ? asked[0] : asked)?.slice(0, 400) ?? '';
  const member = await requireWorkspace(slug);
  const t = await getT();
  const [runs, types, connections] = await Promise.all([
    listRuns(member, 10),
    listRecordTypes(member),
    listConnections(member),
  ]);
  const sources = connections.map((c) => ({
    ...c,
    lastCheckedAt: c.lastCheckedAt?.toISOString() ?? null,
    lastChangedAt: c.lastChangedAt?.toISOString() ?? null,
  }));
  const shown = types.filter((type) => type.count > 0 || type.deleted > 0);
  const editor = canChange(member.role);
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title={t('My data')} />
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/w/${slug}/history`}>
              <History /> {t('Change history')}
            </Link>
          </Button>
          {shown.length > 0 && (
            <Button asChild variant="outline">
              <a href={`/api/w/${slug}/data/download`} download data-testid="download-all">
                <Download /> {t('Download all my data')}
              </a>
            </Button>
          )}
          {editor && (
            <Button asChild>
              <Link href={`/w/${slug}/data/import`}>
                <FileUp /> {t('Add or update files')}
              </Link>
            </Button>
          )}
        </div>
      </div>
      {shown.length > 0 && editor ? <DataChat slug={slug} initial={prefill} /> : null}
      {connected && CONNECTED[connected] && (
        <p role="status" className="rounded-md border bg-muted px-4 py-3 text-sm">
          {t(
            '{source} is connected. We’re reading it now; in a minute you’ll be able to check what we found, the same way as for a file.',
            { source: t(CONNECTED[connected]) },
          )}
        </p>
      )}
      <LinkedSources slug={slug} sources={sources} />
      {shown.length > 0 ? (
        <section className="grid gap-3" aria-labelledby="records-heading">
          <h2 id="records-heading" className="font-medium">
            {t('Your records')}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((type) => (
              <li key={type.key}>
                <Link
                  href={`/w/${slug}/data/${type.key}` as Route}
                  data-testid={`records-${type.key}`}
                  className="grid gap-1 rounded-xl border p-4 hover:bg-muted/50"
                >
                  <span className="font-medium">{t.text(type.label.plural)}</span>
                  <span className="text-2xl font-semibold tabular-nums">
                    {count.format(type.count)}
                  </span>
                  <span className="text-sm text-muted-foreground">{t.text(type.description)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          {t('Your products, sales, customers and more will be here once you bring in your files.')}
        </p>
      )}
      {runs.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('Your imports')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid divide-y text-sm">
              {runs.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/w/${slug}/data/import/${r.id}` as Route}
                    className="flex items-center justify-between gap-4 py-3 hover:underline"
                  >
                    <span>{when.format(r.createdAt)}</span>
                    <span className="text-muted-foreground">
                      {r.undoneAt
                        ? t('Undone')
                        : r.kind === 'reupload' && r.status === 'done'
                          ? t('Updated your data')
                          : t(STATUS[r.status] ?? r.status)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
