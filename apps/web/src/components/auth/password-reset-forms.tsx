'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { useT } from '@/components/i18n/provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';
import { formText } from '@/lib/forms';

export function ForgotPasswordForm() {
  const t = useT();
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    await authClient.requestPasswordReset({
      email: formText(form, 'email').trim(),
      redirectTo: '/reset-password',
    });
    // Same message whether or not the account exists, so nobody can probe for accounts.
    setSent(true);
    setPending(false);
  }

  if (sent) {
    return (
      <Alert tone="success">
        {t(
          'If there’s an account for that email, we’ve sent a link to reset your password. It may take a minute to arrive.',
        )}
      </Alert>
    );
  }
  return (
    <form onSubmit={(e) => void onSubmit(e)} className="grid gap-4">
      <Field id="email" label={t('Email')}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? t('Sending…') : t('Send me a reset link')}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string | undefined }) {
  const t = useT();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  if (!token) {
    return (
      <Alert tone="error">
        {t('This reset link has expired or was already used.')}{' '}
        <Link href="/forgot-password" className="font-medium underline">
          {t('Get a new link')}
        </Link>
      </Alert>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const newPassword = formText(form, 'password');
    if (newPassword.length < 10)
      return setError(t('Your password needs at least {n} characters.', { n: 10 }));
    if (newPassword !== formText(form, 'confirm')) {
      return setError(t('The two passwords don’t match.'));
    }
    setPending(true);
    const { error: err } = await authClient.resetPassword({ newPassword, token: token! });
    setPending(false);
    if (err)
      return setError(
        t('This reset link has expired or was already used. Please ask for a new one.'),
      );
    setDone(true);
  }

  if (done) {
    return (
      <Alert tone="success">
        {t('Your password has been changed.')}{' '}
        <Link href="/sign-in" className="font-medium underline">
          {t('Sign in')}
        </Link>
      </Alert>
    );
  }
  return (
    <form onSubmit={(e) => void onSubmit(e)} className="grid gap-4" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field
        id="password"
        label={t('New password')}
        hint={t('At least {n} characters.', { n: 10 })}
      >
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </Field>
      <Field id="confirm" label={t('Type it again')}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? t('Saving…') : t('Save new password')}
      </Button>
    </form>
  );
}
