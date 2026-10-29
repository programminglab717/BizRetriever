'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { msg, type Translator } from '@bizr/i18n/translate';

import { useT } from '@/components/i18n/provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';

import { GoogleButton, OrDivider } from './google-button';
import { formText } from '@/lib/forms';

const MIN_PASSWORD = 10;
const ALREADY = msg('That email already has an account. Sign in instead?');

function friendlyError(
  t: Translator,
  code: string | undefined,
  status: number,
  fallback: string | undefined,
): string {
  if (status === 429) return t('Too many tries. Please wait a minute and try again.');
  if (code?.includes('ALREADY_EXISTS')) return t(ALREADY);
  if (code === 'PASSWORD_TOO_SHORT')
    return t('Your password needs at least {n} characters.', { n: MIN_PASSWORD });
  if (code === 'INVALID_EMAIL') return t('That email address doesn’t look right.');
  return fallback
    ? t.text(fallback)
    : t('Something went wrong creating your account. Please try again.');
}

export function SignUpForm({
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
    const form = new FormData(event.currentTarget);
    const password = formText(form, 'password');
    if (password.length < MIN_PASSWORD) {
      setError(t('Your password needs at least {n} characters.', { n: MIN_PASSWORD }));
      return;
    }
    setPending(true);
    const { error: err } = await authClient.signUp.email({
      name: formText(form, 'name').trim(),
      email: formText(form, 'email').trim(),
      password,
    });
    if (err) {
      setPending(false);
      setError(friendlyError(t, err.code, err.status, err.message));
      return;
    }
    router.push(next ?? '/onboarding');
    router.refresh();
  }

  return (
    <div className="grid gap-5">
      {googleEnabled ? (
        <>
          {/* i18n-skip: a path */}
          <GoogleButton next={next ?? '/onboarding'} />
          <OrDivider />
        </>
      ) : null}
      <form onSubmit={(e) => void onSubmit(e)} className="grid gap-4" noValidate>
        {error ? (
          <Alert tone="error">
            {error}{' '}
            {error === t(ALREADY) ? (
              <Link href="/sign-in" className="font-medium underline">
                {t('Sign in')}
              </Link>
            ) : null}
          </Alert>
        ) : null}
        <Field id="name" label={t('Your name')}>
          <Input id="name" name="name" autoComplete="name" required />
        </Field>
        <Field id="email" label={t('Email')}>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field
          id="password"
          label={t('Password')}
          hint={t('At least {n} characters.', { n: MIN_PASSWORD })}
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            aria-describedby="password-hint"
            required
          />
        </Field>
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {pending ? t('Creating your account…') : t('Create my account')}
        </Button>
      </form>
    </div>
  );
}
