import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { getT } from '@/lib/i18n';
import { getSession, homePathFor } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const session = await getSession();
  if (session) redirect(await homePathFor(session.user.id));
  const t = await getT();

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm font-medium text-muted-foreground">BizRetriever</p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        {t('Your business, explained.')}
      </h1>
      <p className="text-lg text-muted-foreground">
        {t(
          'Upload the spreadsheets you already have, messy is fine. Get clear answers, a dashboard built for your shop, and a heads-up when something needs your attention.',
        )}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button size="lg" asChild>
          <Link href="/sign-up">{t('Create your free account')}</Link>
        </Button>
        <Button size="lg" variant="outline" asChild>
          <Link href="/sign-in">{t('Sign in')}</Link>
        </Button>
      </div>
    </main>
  );
}
