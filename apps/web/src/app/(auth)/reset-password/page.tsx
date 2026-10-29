import type { Metadata } from 'next';

import { ResetPasswordForm } from '@/components/auth/password-reset-forms';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getT } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Choose a new password · BizRetriever') };
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const t = await getT();
  const token = typeof params.token === 'string' && !params.error ? params.token : undefined;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Choose a new password')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm token={token} />
      </CardContent>
    </Card>
  );
}
