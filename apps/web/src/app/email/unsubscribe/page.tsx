import { checkUnsubscribe } from '@bizr/core/insights';
import { msg } from '@bizr/i18n/translate';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getT } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Email settings · BizRetriever') };
}

const KIND = {
  weekly_summary: {
    name: msg('weekly summaries'),
    stop: msg('Stop weekly summaries'),
    ask: msg('Stop weekly summaries?'),
  },
  urgent_alert: {
    name: msg('urgent alerts'),
    stop: msg('Stop urgent alerts'),
    ask: msg('Stop urgent alerts?'),
  },
  mention: {
    name: msg('emails when someone mentions you'),
    stop: msg('Stop these emails'),
    ask: msg('Stop these emails?'),
  },
} as const;

type Params = Partial<Record<'w' | 'u' | 'k' | 't' | 'done' | 'bad', string>>;

/** Where the "Stop …" link in an email lands: one button, no sign-in. */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const t = await getT();
  const [before, after] = t('{link} and open Alert settings to choose which emails you get.').split(
    '{link}',
  );
  const done =
    p.done === 'weekly_summary' || p.done === 'urgent_alert' || p.done === 'mention'
      ? KIND[p.done]
      : null;
  const valid = !done && !p.bad && checkUnsubscribe(p);
  const action = valid
    ? `/api/email/unsubscribe?${new URLSearchParams({ w: p.w, u: p.u, k: p.k, t: p.t, from: 'page' }).toString()}`
    : '';
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-content-center p-4">
      <Card>
        {done ? (
          <CardHeader>
            <CardTitle>{t('Done')}</CardTitle>
            <CardDescription>
              {t('You won’t get {name} any more. You can turn them back on in Alert settings.', {
                name: t(done.name),
              })}
            </CardDescription>
          </CardHeader>
        ) : valid ? (
          <>
            <CardHeader>
              <CardTitle>{t(KIND[p.k].ask)}</CardTitle>
              <CardDescription>
                {t(
                  'We’ll stop sending you {name} for this business. Everything stays on your Home page.',
                  { name: t(KIND[p.k].name) },
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form method="post" action={action}>
                <Button type="submit">{t(KIND[p.k].stop)}</Button>
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
