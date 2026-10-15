import { listRuns } from '@bizr/core/ingestion';
import type { Route } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireWorkspace } from '@/lib/session';

export default async function HomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const member = await requireWorkspace(slug);
  const [latest] = await listRuns(member, 1);
  const inProgress =
    latest && ['analyzing', 'review', 'revising', 'applying'].includes(latest.status)
      ? latest
      : undefined;
  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Welcome, ${member.user.name.split(' ')[0]}`}
        description={member.workspace.name}
      />
      {inProgress ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {inProgress.status === 'review'
                ? 'Your files are ready to check'
                : 'We’re working on your files'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild size="lg">
              <Link href={`/w/${slug}/data/import/${inProgress.id}` as Route}>Continue</Link>
            </Button>
          </CardContent>
        </Card>
      ) : latest?.status === 'done' ? (
        <Card>
          <CardHeader>
            <CardTitle>Your data is in</CardTitle>
            <CardDescription>
              Your dashboard, questions and alerts arrive in the next updates.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild variant="outline">
              <Link href={`/w/${slug}/data/import/${latest.id}` as Route}>
                See your data report
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Let’s bring in your data</CardTitle>
            <CardDescription>
              Your sales, stock lists, supplier orders and expenses. Excel or CSV, messy is fine.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <ol className="grid gap-2 text-sm text-muted-foreground">
              <li>1. Upload the spreadsheets you already have.</li>
              <li>2. We work out what’s in them and check anything we’re unsure about with you.</li>
              <li>3. You get answers, a dashboard and alerts about your business.</li>
            </ol>
            <div>
              <Button asChild size="lg">
                <Link href={`/w/${slug}/data/import`}>Upload files</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
