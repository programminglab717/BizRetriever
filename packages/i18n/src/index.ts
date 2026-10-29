import { es } from './es';
import { makeTranslator, type Catalog, type Language, type Translator } from './translate';

export {
  fill,
  isLanguage,
  languageNames,
  languages,
  makeTranslator,
  msg,
  pickLanguage,
  placeholders,
  type Catalog,
  type Language,
  type Translator,
  type Vars,
} from './translate';

/** Every catalog, by language. English needs none: its text is the key. */
export const catalogs: Record<Language, Catalog> = { en: {}, es };

const made = new Map<Language, Translator>();

/** The translator for a language (made once). */
export function translator(lang: Language): Translator {
  let t = made.get(lang);
  if (!t) made.set(lang, (t = makeTranslator(lang, catalogs[lang])));
  return t;
}
