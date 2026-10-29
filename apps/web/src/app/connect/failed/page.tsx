import { msg } from '@bizr/i18n/translate';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getT } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Connecting · BizRetriever') };
}

const NAMES: Record<string, string> = {
  quickbooks: 'QuickBooks',
  xero: 'Xero',
  square: 'Square',
  woocommerce: msg('your WooCommerce store'),
};

/** Where a connection that didn't work lands (M18). `source` and `why` are codes; the text is ours. */
export default async function ConnectFailedPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; why?: string }>;
}) {
  const { source, why } = await searchParams;
  const t = await getT();
  const name = t(NAMES[source ?? ''] ?? msg('that account'));
  const cap = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;
  const message =
    why === 'declined'
      ? cap(
          t(
            '{name} wasn’t connected, so nothing was brought in. You can try again any time from My data.',
            { name },
          ),
        )
      : why === 'provider'
        ? cap(
            t(
              '{name} didn’t answer, or didn’t give us access. Please try again in a few minutes.',
              { name },
            ),
          )
        : t(
            'That connection didn’t work. Please start again from My data, signed in to BizRetriever.',
          );
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-content-center p-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('We couldn’t connect {name}', { name })}</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/">{t('Back to BizRetriever')}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
