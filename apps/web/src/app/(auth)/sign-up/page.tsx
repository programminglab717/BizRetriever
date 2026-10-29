import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SignUpForm } from '@/components/auth/sign-up-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { isGoogleEnabled } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { safeNextPath } from '@/lib/redirects';
import { getSession, homePathFor } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Create your account · BizRetriever') };
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (session) redirect(await homePathFor(session.user.id));
  const next = safeNextPath((await searchParams).next);
  const t = await getT();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Create your free account')}</CardTitle>
        <CardDescription>{t('Then bring in your spreadsheets. Messy is fine.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <SignUpForm googleEnabled={isGoogleEnabled()} {...(next ? { next } : {})} />
        <p className="text-center text-sm text-muted-foreground">
          {t('Already have an account?')}{' '}
          <Link
            // i18n-skip: a path
            href={next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in'}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t('Sign in')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
