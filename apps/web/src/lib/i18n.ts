import 'server-only';

import { getMemberWorkspace, userLanguage } from '@bizr/core/workspaces';
import { catalogs, pickLanguage, translator, type Language, type Translator } from '@bizr/i18n';
import { headers } from 'next/headers';
import { cache } from 'react';

import { getSession } from './session';

/** Set by `proxy.ts` on workspace pages, so the business's default language is known anywhere. */
export const SLUG_HEADER = 'x-bizr-slug';

/**
 * The reader's language (M20, ADR-071): their own choice; else, inside a business, the business's
 * default; else their browser's.
 */
export const getLanguage = cache(async (): Promise<Language> => {
  const h = await headers();
  const session = await getSession();
  if (session) {
    const own = await userLanguage(session.user.id);
    if (own) return own;
    const slug = h.get(SLUG_HEADER);
    const member = slug ? await getMemberWorkspace(slug, session.user.id) : undefined;
    if (member) return member.settings.language;
  }
  return pickLanguage(h.get('accept-language'));
});

/** `const t = await getT()` in server components, server actions and route handlers. */
export const getT = cache(async (): Promise<Translator> => translator(await getLanguage()));

/** What the browser needs to translate: only the reader's catalog. */
export async function clientI18n(): Promise<{ lang: Language; catalog: Record<string, string> }> {
  const lang = await getLanguage();
  return { lang, catalog: { ...catalogs[lang] } };
}
