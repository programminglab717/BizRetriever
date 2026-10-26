import { checkUnsubscribe } from '@bizr/core/insights';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Email settings · BizRetriever' };

const KIND = {
  weekly_summary: { name: 'weekly summaries', stop: 'Stop weekly summaries' },
  urgent_alert: { name: 'urgent alerts', stop: 'Stop urgent alerts' },
} as const;

type Params = Partial<Record<'w' | 'u' | 'k' | 't' | 'done' | 'bad', string>>;

/** Where the "Stop …" link in an email lands: one button, no sign-in. */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const done = p.done === 'weekly_summary' || p.done === 'urgent_alert' ? KIND[p.done] : null;
  const valid = !done && !p.bad && checkUnsubscribe(p);
  const action = valid
    ? `/api/email/unsubscribe?${new URLSearchParams({ w: p.w, u: p.u, k: p.k, t: p.t, from: 'page' }).toString()}`
    : '';
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-content-center p-4">
      <Card>
        {done ? (
          <CardHeader>
            <CardTitle>Done</CardTitle>
            <CardDescription>
              You won’t get {done.name} any more. You can turn them back on in Alert settings.
            </CardDescription>
          </CardHeader>
        ) : valid ? (
          <>
            <CardHeader>
              <CardTitle>{KIND[p.k].stop}?</CardTitle>
              <CardDescription>
                We’ll stop sending you {KIND[p.k].name} for this business. Everything stays on your
                Home page.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form method="post" action={action}>
                <Button type="submit">{KIND[p.k].stop}</Button>
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
              and open Alert settings to choose which emails you get.
            </CardDescription>
          </CardHeader>
        )}
      </Card>
    </main>
  );
}
