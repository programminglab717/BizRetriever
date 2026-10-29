'use client';

import { useActionState } from 'react';

import type { OnboardingState } from '@/app/onboarding/actions';
import { useT } from '@/components/i18n/provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { BusinessSettingsFields } from './business-settings-fields';

export interface IndustryOption {
  id: string;
  title: string;
  description: string;
  available: boolean;
}

export function OnboardingForm({
  action,
  industries,
  currencies,
}: {
  action: (state: OnboardingState, formData: FormData) => Promise<OnboardingState>;
  industries: IndustryOption[];
  currencies: readonly { code: string; label: string }[];
}) {
  const t = useT();
  const [state, formAction, pending] = useActionState(action, {});
  const firstAvailable = industries.find((i) => i.available)?.id;

  return (
    <form action={formAction} className="grid gap-6">
      {state.formError ? <Alert tone="error">{state.formError}</Alert> : null}

      <Field id="name" label={t('What’s your business called?')} error={state.fieldErrors?.name}>
        <Input
          id="name"
          name="name"
          autoComplete="organization"
          maxLength={80}
          required
          autoFocus
        />
      </Field>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">{t('What do you sell, and how?')}</legend>
        <div className="grid gap-2">
          {industries.map((industry) => (
            <label
              key={industry.id}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-4 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                industry.available ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name="packId"
                value={industry.id}
                defaultChecked={industry.id === firstAvailable}
                disabled={!industry.available}
                className="mt-1 accent-primary"
              />
              <span className="grid gap-0.5">
                <span className="font-medium">
                  {industry.title}
                  {!industry.available ? (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal">
                      {t('Coming soon')}
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground">{industry.description}</span>
              </span>
            </label>
          ))}
        </div>
        {state.fieldErrors?.packId ? (
          <p className="text-sm text-destructive">{state.fieldErrors.packId}</p>
        ) : null}
      </fieldset>

      <BusinessSettingsFields currencies={currencies} errors={state.fieldErrors} />

      <p className="text-sm text-muted-foreground">
        {t('You can change any of this later in Settings.')}
      </p>
      <Button
        type="submit"
        size="lg"
        disabled={pending}
        className="w-full sm:w-auto sm:justify-self-start"
      >
        {pending ? t('Setting up your business…') : t('Continue')}
      </Button>
    </form>
  );
}
