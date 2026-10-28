import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Connecting · BizRetriever' };

const NAMES: Record<string, string> = {
  quickbooks: 'QuickBooks',
  xero: 'Xero',
  square: 'Square',
  woocommerce: 'your WooCommerce store',
};

/** Where a connection that didn't work lands (M18). `source` and `why` are codes; the text is ours. */
export default async function ConnectFailedPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; why?: string }>;
}) {
  const { source, why } = await searchParams;
  const name = NAMES[source ?? ''] ?? 'that account';
  const message =
    why === 'declined'
      ? `${name[0]!.toUpperCase()}${name.slice(1)} wasn’t connected, so nothing was brought in. You can try again any time from My data.`
      : why === 'provider'
        ? `${name[0]!.toUpperCase()}${name.slice(1)} didn’t answer, or didn’t give us access. Please try again in a few minutes.`
        : 'That connection didn’t work. Please start again from My data, signed in to BizRetriever.';
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-content-center p-4">
      <Card>
        <CardHeader>
          <CardTitle>We couldn’t connect {name}</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/">Back to BizRetriever</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
