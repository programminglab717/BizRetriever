'use client';

import type { DateOrder } from '@bizr/db/schema';
import { languageNames, languages, msg, type Language } from '@bizr/i18n/translate';
import { useEffect, useState } from 'react';

import { useT } from '@/components/i18n/provider';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { allTimezones, browserDefaults } from './locale-defaults';

const DATE_ORDERS: { value: DateOrder; title: string; example: string }[] = [
  { value: 'DMY', title: msg('Day first'), example: msg('03/04/2026 means 3 April 2026') },
  { value: 'MDY', title: msg('Month first'), example: msg('03/04/2026 means March 4, 2026') },
  { value: 'YMD', title: msg('Year first'), example: msg('2026/04/03 means 3 April 2026') },
];

export interface SettingsValues {
  currency: string;
  timezone: string;
  dateOrder: DateOrder;
  /** What the business reads by default (M20). */
  language?: Language;
}

/**
 * Currency, date order and time zone. With no `initial` values (onboarding) the browser's locale
 * is used as a starting guess.
 */
export function BusinessSettingsFields({
  currencies,
  initial,
  errors,
  currencyLocked = false,
}: {
  currencies: readonly { code: string; label: string }[];
  initial?: SettingsValues;
  errors?: Partial<Record<keyof SettingsValues, string>> | undefined;
  /** Records are already in this currency (M20): it can't change any more. */
  currencyLocked?: boolean;
}) {
  const t = useT();
  const [values, setValues] = useState<SettingsValues>(
    initial ?? { currency: 'USD', timezone: 'UTC', dateOrder: 'MDY', language: t.lang },
  );
  const [timezones, setTimezones] = useState<string[]>([values.timezone]);

  useEffect(() => {
    const next = initial ?? browserDefaults();
    const zones = allTimezones();
    // e.g. "UTC" is valid but isn't in Intl's list; never let the select silently pick another zone.
    setTimezones(zones.includes(next.timezone) ? zones : [next.timezone, ...zones]);
    if (!initial) setValues({ ...next, language: t.lang });
  }, [initial, t.lang]);

  const currencyOptions = currencies.some((c) => c.code === values.currency)
    ? currencies
    : [...currencies, { code: values.currency, label: values.currency }];

  return (
    <>
      <Field
        id="currency"
        label={t('Currency')}
        error={errors?.currency}
        hint={
          currencyLocked
            ? t(
                'Your records are kept in this currency, so it can’t change now. Amounts in other currencies are converted when they come in.',
              )
            : t('Amounts in other currencies are converted to this one when they come in.')
        }
      >
        {currencyLocked ? <input type="hidden" name="currency" value={values.currency} /> : null}
        <Select
          id="currency"
          // i18n-skip: a field name
          name={currencyLocked ? undefined : 'currency'}
          value={values.currency}
          disabled={currencyLocked}
          aria-describedby="currency-hint"
          onChange={(e) => setValues((v) => ({ ...v, currency: e.target.value }))}
        >
          {currencyOptions.map((c) => (
            <option key={c.code} value={c.code}>
              {t.text(c.label)}
            </option>
          ))}
        </Select>
      </Field>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">{t('How do you write dates?')}</legend>
        <p className="-mt-1 mb-1 text-sm text-muted-foreground">
          {t('This helps us read the dates in your files correctly.')}
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {DATE_ORDERS.map((o) => (
            <label
              key={o.value}
              className={cn(
                'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                values.dateOrder === o.value && 'border-primary bg-primary/5',
              )}
            >
              <input
                type="radio"
                name="dateOrder"
                value={o.value}
                checked={values.dateOrder === o.value}
                onChange={() => setValues((v) => ({ ...v, dateOrder: o.value }))}
                className="sr-only"
              />
              <span className="font-medium">{t(o.title)}</span>
              <span className="text-muted-foreground">{t(o.example)}</span>
            </label>
          ))}
        </div>
        {errors?.dateOrder ? <p className="text-sm text-destructive">{errors.dateOrder}</p> : null}
      </fieldset>

      <Field id="timezone" label={t('Time zone')} error={errors?.timezone}>
        <Select
          id="timezone"
          name="timezone"
          value={values.timezone}
          onChange={(e) => setValues((v) => ({ ...v, timezone: e.target.value }))}
        >
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replaceAll('_', ' ')}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        id="language"
        label={t('Language')}
        hint={t(
          'What your business reads in: screens, answers, emails and downloads. Each person can choose their own.',
        )}
      >
        <Select
          id="language"
          name="language"
          // i18n-skip: a language code
          value={values.language ?? 'en'}
          aria-describedby="language-hint"
          onChange={(e) => setValues((v) => ({ ...v, language: e.target.value as Language }))}
        >
          {languages.map((l) => (
            <option key={l} value={l} lang={l}>
              {languageNames[l]}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}
