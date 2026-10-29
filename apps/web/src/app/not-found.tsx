import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { getT } from '@/lib/i18n';

export default async function NotFound() {
  const t = await getT();
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-content-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{t('We couldn’t find that page')}</h1>
      <p className="text-muted-foreground">
        {t('The link may be out of date, or the page was moved. Your data is safe.')}
      </p>
      <div>
        <Button asChild>
          <Link href="/">{t('Go to my business')}</Link>
        </Button>
      </div>
    </main>
  );
}
