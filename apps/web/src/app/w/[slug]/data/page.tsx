import { listRuns } from '@bizr/core/ingestion';
import { FileUp } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

import { ComingSoon, PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireWorkspace } from '@/lib/session';

const STATUS: Record<string, string> = {
  analyzing: 'Working on it',
  review: 'Waiting for you to check',
  revising: 'Updating',
  applying: 'Setting up',
  merge_review: 'Waiting for you to check the changes',
  merging: 'Updating your data',
  done: 'Brought in',
  failed: 'Didn’t finish',
  cancelled: 'Stopped',
};

const when = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

export default async function DataPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const member = await requireWorkspace(slug);
  const runs = await listRuns(member, 10);
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="My data" />
        <Button asChild>
          <Link href={`/w/${slug}/data/import`}>
            <FileUp /> Add or update files
          </Link>
        </Button>
      </div>
      {runs.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your imports</CardTitle>
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
                        ? 'Undone'
                        : r.kind === 'reupload' && r.status === 'done'
                          ? 'Updated your data'
                          : (STATUS[r.status] ?? r.status)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      <ComingSoon title="Your records">
        Browsing your products, sales, customers and more arrives in the next update.
      </ComingSoon>
    </div>
  );
}
