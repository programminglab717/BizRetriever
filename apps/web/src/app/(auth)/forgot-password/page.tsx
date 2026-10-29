import type { Metadata } from 'next';
import Link from 'next/link';

import { ForgotPasswordForm } from '@/components/auth/password-reset-forms';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getT } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Reset your password · BizRetriever') };
}

export default async function ForgotPasswordPage() {
  const t = await getT();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Forgot your password?')}</CardTitle>
        <CardDescription>
          {t('Enter your email and we’ll send you a link to choose a new one.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <ForgotPasswordForm />
        <p className="text-center text-sm">
          <Link
            href="/sign-in"
            className="text-muted-foreground underline-offset-4 hover:underline"
          >
            {t('Back to sign in')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
