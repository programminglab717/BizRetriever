'use client';

import { useActionState } from 'react';

import type { SettingsState } from '@/app/w/[slug]/settings/actions';
import {
  BusinessSettingsFields,
  type SettingsValues,
} from '@/components/onboarding/business-settings-fields';
import { useT } from '@/components/i18n/provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export function BusinessForm({
  action,
  name,
  settings,
  currencies,
  currencyLocked,
}: {
  action: (state: SettingsState, formData: FormData) => Promise<SettingsState>;
  name: string;
  settings: SettingsValues;
  currencies: readonly { code: string; label: string }[];
  currencyLocked: boolean;
}) {
  const t = useT();
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="grid gap-6">
      {state.saved ? <Alert tone="success">{t('Saved.')}</Alert> : null}
      {state.formError ? <Alert tone="error">{state.formError}</Alert> : null}
      <Field id="name" label={t('Business name')} error={state.fieldErrors?.name}>
        <Input id="name" name="name" defaultValue={name} maxLength={80} required />
      </Field>
      <BusinessSettingsFields
        currencies={currencies}
        initial={settings}
        errors={state.fieldErrors}
        currencyLocked={currencyLocked}
      />
      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending ? t('Saving…') : t('Save changes')}
      </Button>
    </form>
  );
}
