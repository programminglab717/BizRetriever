import { getInvite } from '@bizr/core/workspaces';
import { msg } from '@bizr/i18n/translate';
import type { Metadata, Route } from 'next';
import Link from 'next/link';

import { JoinButton } from '@/components/settings/join-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getT } from '@/lib/i18n';
import { getSession } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Invitation · BizRetriever') };
}

const STATUS = {
  used: msg('This invitation has already been used.'),
  expired: msg('This invitation has expired. Ask the owner for a new one.'),
  cancelled: msg('This invitation was cancelled. Ask the owner for a new one.'),
} as const;

/** The link in an invitation email: join the business (after signing in or creating an account). */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite, session] = await Promise.all([getInvite(token), getSession()]);
  const here = `/invite/${token}`;
  const t = await getT();
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-content-center p-4">
      <Card>
        {!invite ? (
          <CardHeader>
            <CardTitle>{t('This link doesn’t work')}</CardTitle>
            <CardDescription>
              {t('Ask the person who invited you to send a new one.')}
            </CardDescription>
          </CardHeader>
        ) : (
          <>
            <CardHeader>
              <CardTitle>{t('Join {business}', { business: invite.businessName })}</CardTitle>
              <CardDescription>
                {invite.role === 'viewer'
                  ? t(
                      '{name} invited {email} to see {business} on BizRetriever. You’ll be able to look at everything and ask questions, but not change anything.',
                      {
                        name: invite.invitedBy ?? t('Someone'),
                        email: invite.email,
                        business: invite.businessName,
                      },
                    )
                  : t('{name} invited {email} to help run {business} on BizRetriever.', {
                      name: invite.invitedBy ?? t('Someone'),
                      email: invite.email,
                      business: invite.businessName,
                    })}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {invite.status !== 'pending' ? (
                <p>{t(STATUS[invite.status])}</p>
              ) : session ? (
                <JoinButton token={token} />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button asChild>
                    <Link href={`/sign-up?next=${encodeURIComponent(here)}` as Route}>
                      {t('Create an account')}
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href={`/sign-in?next=${encodeURIComponent(here)}` as Route}>
                      {t('I have an account')}
                    </Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </>
        )}
      </Card>
    </main>
  );
}
