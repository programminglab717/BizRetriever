import { getInvite } from '@bizr/core/workspaces';
import type { Metadata, Route } from 'next';
import Link from 'next/link';

import { JoinButton } from '@/components/settings/join-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Invitation · BizRetriever' };

const STATUS = {
  used: 'This invitation has already been used.',
  expired: 'This invitation has expired. Ask the owner for a new one.',
  cancelled: 'This invitation was cancelled. Ask the owner for a new one.',
} as const;

/** The link in an invitation email: join the business (after signing in or creating an account). */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite, session] = await Promise.all([getInvite(token), getSession()]);
  const here = `/invite/${token}`;
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-content-center p-4">
      <Card>
        {!invite ? (
          <CardHeader>
            <CardTitle>This link doesn’t work</CardTitle>
            <CardDescription>Ask the person who invited you to send a new one.</CardDescription>
          </CardHeader>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Join {invite.businessName}</CardTitle>
              <CardDescription>
                {invite.invitedBy ?? 'Someone'} invited {invite.email} to help run{' '}
                {invite.businessName} on BizRetriever.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {invite.status !== 'pending' ? (
                <p>{STATUS[invite.status]}</p>
              ) : session ? (
                <JoinButton token={token} />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button asChild>
                    <Link href={`/sign-up?next=${encodeURIComponent(here)}` as Route}>
                      Create an account
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href={`/sign-in?next=${encodeURIComponent(here)}` as Route}>
                      I have an account
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
