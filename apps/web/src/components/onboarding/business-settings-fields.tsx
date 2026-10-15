'use client';

import type { DateOrder } from '@bizr/db/schema';
import { useEffect, useState } from 'react';

import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { allTimezones, browserDefaults } from './locale-defaults';

const DATE_ORDERS: { value: DateOrder; title: string; example: string }[] = [
  { value: 'DMY', title: 'Day first', example: '03/04/2026 means 3 April 2026' },
  { value: 'MDY', title: 'Month first', example: '03/04/2026 means March 4, 2026' },
  { value: 'YMD', title: 'Year first', example: '2026/04/03 means 3 April 2026' },
];

export interface SettingsValues {
  currency: string;
  timezone: string;
  dateOrder: DateOrder;
}

/**
 * Currency, date order and time zone. With no `initial` values (onboarding) the browser's locale
 * is used as a starting guess.
 */
export function BusinessSettingsFields({
  currencies,
  initial,
  errors,
}: {
  currencies: readonly { code: string; label: string }[];
  initial?: SettingsValues;
  errors?: Partial<Record<keyof SettingsValues, string>> | undefined;
}) {
  const [values, setValues] = useState<SettingsValues>(
    initial ?? { currency: 'USD', timezone: 'UTC', dateOrder: 'MDY' },
  );
  const [timezones, setTimezones] = useState<string[]>([values.timezone]);

  useEffect(() => {
    const next = initial ?? browserDefaults();
    const zones = allTimezones();
    // e.g. "UTC" is valid but isn't in Intl's list; never let the select silently pick another zone.
    setTimezones(zones.includes(next.timezone) ? zones : [next.timezone, ...zones]);
    if (!initial) setValues(next);
  }, [initial]);

  const currencyOptions = currencies.some((c) => c.code === values.currency)
    ? currencies
    : [...currencies, { code: values.currency, label: values.currency }];

  return (
    <>
      <Field id="currency" label="Currency" error={errors?.currency}>
        <Select
          id="currency"
          name="currency"
          value={values.currency}
          onChange={(e) => setValues((v) => ({ ...v, currency: e.target.value }))}
        >
          {currencyOptions.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">How do you write dates?</legend>
        <p className="-mt-1 mb-1 text-sm text-muted-foreground">
          This helps us read the dates in your files correctly.
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
              <span className="font-medium">{o.title}</span>
              <span className="text-muted-foreground">{o.example}</span>
            </label>
          ))}
        </div>
        {errors?.dateOrder ? <p className="text-sm text-destructive">{errors.dateOrder}</p> : null}
      </fieldset>

      <Field id="timezone" label="Time zone" error={errors?.timezone}>
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
    </>
  );
}
