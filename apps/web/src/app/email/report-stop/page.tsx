import { checkReportStop } from '@bizr/core/reports';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Stop a report · BizRetriever' };

type Params = Partial<Record<'r' | 'u' | 't' | 'done' | 'bad', string>>;

/** Where a report email's "Stop this report" link lands: one button, no sign-in (M15). */
export default async function ReportStopPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const valid = !p.done && !p.bad && checkReportStop(p);
  const action = valid
    ? `/api/email/report-stop?${new URLSearchParams({ r: p.r, u: p.u, t: p.t, from: 'page' }).toString()}`
    : '';
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-content-center p-4">
      <Card>
        {p.done ? (
          <CardHeader>
            <CardTitle>Done</CardTitle>
            <CardDescription>
              This report won’t be sent any more. You can turn it back on in Alert settings, under
              Your reports.
            </CardDescription>
          </CardHeader>
        ) : valid ? (
          <>
            <CardHeader>
              <CardTitle>Stop this report?</CardTitle>
              <CardDescription>
                We’ll stop emailing it to you. Nothing else changes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form method="post" action={action}>
                <Button type="submit">Stop this report</Button>
              </form>
            </CardContent>
          </>
        ) : (
          <CardHeader>
            <CardTitle>This link doesn’t work</CardTitle>
            <CardDescription>
              <Link href="/sign-in" className="text-primary underline underline-offset-4">
                Sign in
              </Link>{' '}
              and open Alert settings to manage your reports.
            </CardDescription>
          </CardHeader>
        )}
      </Card>
    </main>
  );
}
