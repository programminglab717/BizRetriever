import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SignInForm } from '@/components/auth/sign-in-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isGoogleEnabled } from '@/lib/auth';
import { safeNextPath } from '@/lib/redirects';
import { getSession, homePathFor } from '@/lib/session';

export const metadata: Metadata = { title: 'Sign in · BizRetriever' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (session) redirect(await homePathFor(session.user.id));
  const next = safeNextPath((await searchParams).next);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome back</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6">
        <SignInForm googleEnabled={isGoogleEnabled()} {...(next ? { next } : {})} />
        <p className="text-center text-sm text-muted-foreground">
          New here?{' '}
          <Link
            href={next ? `/sign-up?next=${encodeURIComponent(next)}` : '/sign-up'}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Create a free account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
