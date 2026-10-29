'use client';

import { makeTranslator, type Language, type Translator } from '@bizr/i18n/translate';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

const english = makeTranslator('en', {});
const I18nContext = createContext<Translator>(english);

/** Gives client components the reader's translator (`useT`). */
export function I18nProvider({
  lang,
  catalog,
  children,
}: {
  lang: Language;
  catalog: Record<string, string>;
  children: ReactNode;
}) {
  const t = useMemo(() => makeTranslator(lang, catalog), [lang, catalog]);
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>;
}

/** `const t = useT()` in client components. */
export function useT(): Translator {
  return useContext(I18nContext);
}
