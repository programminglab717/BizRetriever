'use client';

import { languageNames, languages, type Language } from '@bizr/i18n/translate';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { useT } from '@/components/i18n/provider';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';

/** "Your language" (M20): the person's own choice, or the business's. Saves as soon as it changes. */
export function MyLanguage({
  action,
  own,
  business,
}: {
  action: (language: string) => Promise<{ ok: boolean }>;
  own: Language | null;
  business: Language;
}) {
  const t = useT();
  const router = useRouter();
  const [value, setValue] = useState<string>(own ?? '');
  const [pending, start] = useTransition();
  return (
    <Field
      id="my-language"
      label={t('Your language')}
      hint={t('Only for you, in every business you’re part of.')}
    >
      <Select
        id="my-language"
        value={value}
        disabled={pending}
        aria-describedby="my-language-hint"
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          start(async () => {
            await action(next);
            router.refresh();
          });
        }}
      >
        <option value="">
          {t('Same as the business ({language})', { language: languageNames[business] })}
        </option>
        {languages.map((l) => (
          <option key={l} value={l} lang={l}>
            {languageNames[l]}
          </option>
        ))}
      </Select>
    </Field>
  );
}
