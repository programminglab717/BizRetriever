import type { Metadata } from 'next';
import Link from 'next/link';

import { ForgotPasswordForm } from '@/components/auth/password-reset-forms';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Reset your password · BizRetriever' };

export default function ForgotPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Forgot your password?</CardTitle>
        <CardDescription>
          Enter your email and we’ll send you a link to choose a new one.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <ForgotPasswordForm />
        <p className="text-center text-sm">
          <Link
            href="/sign-in"
            className="text-muted-foreground underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
