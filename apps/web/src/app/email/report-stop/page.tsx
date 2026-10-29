import { checkReportStop } from '@bizr/core/reports';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getT } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Stop a report · BizRetriever') };
}

type Params = Partial<Record<'r' | 'u' | 't' | 'done' | 'bad', string>>;

/** Where a report email's "Stop this report" link lands: one button, no sign-in (M15). */
export default async function ReportStopPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const t = await getT();
  const [before, after] = t('{link} and open Alert settings to manage your reports.').split(
    '{link}',
  );
  const valid = !p.done && !p.bad && checkReportStop(p);
  const action = valid
    ? `/api/email/report-stop?${new URLSearchParams({ r: p.r, u: p.u, t: p.t, from: 'page' }).toString()}`
    : '';
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-content-center p-4">
      <Card>
        {p.done ? (
          <CardHeader>
            <CardTitle>{t('Done')}</CardTitle>
            <CardDescription>
              {t(
                'This report won’t be sent any more. You can turn it back on in Alert settings, under Your reports.',
              )}
            </CardDescription>
          </CardHeader>
        ) : valid ? (
          <>
            <CardHeader>
              <CardTitle>{t('Stop this report?')}</CardTitle>
              <CardDescription>
                {t('We’ll stop emailing it to you. Nothing else changes.')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form method="post" action={action}>
                <Button type="submit">{t('Stop this report')}</Button>
              </form>
            </CardContent>
          </>
        ) : (
          <CardHeader>
            <CardTitle>{t('This link doesn’t work')}</CardTitle>
            <CardDescription>
              {before}
              <Link href="/sign-in" className="text-primary underline underline-offset-4">
                {t('Sign in')}
              </Link>
              {after}
            </CardDescription>
          </CardHeader>
        )}
      </Card>
    </main>
  );
}
