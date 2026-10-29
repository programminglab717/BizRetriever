'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { useT } from '@/components/i18n/provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';

import { GoogleButton, OrDivider } from './google-button';
import { formText } from '@/lib/forms';

export function SignInForm({
  googleEnabled,
  next,
}: {
  googleEnabled: boolean;
  next?: Route | undefined;
}) {
  const t = useT();
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const { error: err } = await authClient.signIn.email({
      email: formText(form, 'email').trim(),
      password: formText(form, 'password'),
    });
    if (err) {
      setPending(false);
      setError(
        err.status === 429
          ? t('Too many tries. Please wait a minute and try again.')
          : t('That email and password don’t match. Please try again.'),
      );
      return;
    }
    // The home page sends people to their business (or to onboarding if they have none yet).
    router.push(next ?? '/');
    router.refresh();
  }

  return (
    <div className="grid gap-5">
      {googleEnabled ? (
        <>
          <GoogleButton next={next} />
          <OrDivider />
        </>
      ) : null}
      <form onSubmit={(e) => void onSubmit(e)} className="grid gap-4" noValidate>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field id="email" label={t('Email')}>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field id="password" label={t('Password')}>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <div className="-mt-1 text-right text-sm">
          <Link
            href="/forgot-password"
            className="text-muted-foreground underline-offset-4 hover:underline"
          >
            {t('Forgot your password?')}
          </Link>
        </div>
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {pending ? t('Signing in…') : t('Sign in')}
        </Button>
      </form>
    </div>
  );
}
