import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getT } from '@/lib/i18n';

// i18n-skip: names only
export const metadata: Metadata = { title: 'Shopify · BizRetriever' };

/** Where a Shopify connection that didn't work lands. `why` is a code; the text is ours. */
export default async function ShopifyFailedPage({
  searchParams,
}: {
  searchParams: Promise<{ why?: string }>;
}) {
  const { why } = await searchParams;
  const t = await getT();
  const message =
    why === 'shopify'
      ? t('Shopify didn’t answer, or didn’t give us access. Please try again in a few minutes.')
      : t(
          'That connection didn’t work. Please start again from My data, signed in to BizRetriever.',
        );
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-content-center p-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('We couldn’t connect your store')}</CardTitle>
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
