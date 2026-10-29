/**
 * Translations (M20, ADR-071). English text is the key, gettext style: code is written in English,
 * and a catalog maps each English string to its Spanish. A string with no translation shows in
 * English, so a missing entry is never an error (a test keeps the catalog complete).
 *
 * Placeholders are `{name}`. Text that was written in English earlier and stored (a data report, an
 * insight) is translated when it's shown, by matching it against the catalog's templates.
 */

export const languages = ['en', 'es'] as const;
export type Language = (typeof languages)[number];

export const languageNames: Record<Language, string> = { en: 'English', es: 'Español' };

export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && (languages as readonly string[]).includes(v);
}

/** The best of our languages for an `Accept-Language` header (or a browser's language list). */
export function pickLanguage(accept: string | readonly string[] | null | undefined): Language {
  const list = typeof accept === 'string' ? accept.split(',') : (accept ?? []);
  const ranked = list
    .map((part, i) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.trim().slice(2)) || 0 : 1, i };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { tag } of ranked) {
    const base = tag.split('-')[0];
    if (isLanguage(base)) return base;
  }
  return 'en';
}

export type Vars = Record<string, string | number>;
export type Catalog = Readonly<Record<string, string>>;

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

export function fill(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const v = vars[name];
    if (v === undefined) return whole;
    return typeof v === 'number' ? v.toLocaleString('en-US') : v;
  });
}

export function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1]!).sort();
}

interface Pattern {
  re: RegExp;
  names: string[];
  to: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(catalog: Catalog): Pattern[] {
  const out: Pattern[] = [];
  for (const [from, to] of Object.entries(catalog)) {
    if (!from.includes('{')) continue;
    const names: string[] = [];
    let src = '';
    let last = 0;
    for (const m of from.matchAll(PLACEHOLDER)) {
      src += escapeRe(from.slice(last, m.index));
      src += '(.+?)';
      names.push(m[1]!);
      last = m.index + m[0].length;
    }
    src += escapeRe(from.slice(last));
    // Templates that are all placeholder ("{a} {b}") would match anything.
    if (from.replace(PLACEHOLDER, '').trim().length < 3) continue;
    out.push({ re: new RegExp(`^${src}$`, 's'), names, to });
  }
  // Longer templates first: the most specific wins.
  return out.sort((a, b) => b.re.source.length - a.re.source.length);
}

export interface Translator {
  readonly lang: Language;
  /** `t('Saved {n} records', { n })`: the translation of an English string, filled in. */
  (english: string, vars?: Vars): string;
  /**
   * Text whose translation depends on where it's used: `t.ctx('button', 'Change')` reads the
   * catalog entry `button|Change` (the verb), so the field label "Change" can be the noun.
   */
  ctx(context: string, english: string, vars?: Vars): string;
  /** One of two forms by count: `t.plural(n, '{n} record', '{n} records')` (`n` is filled in). */
  plural(n: number, one: string, many: string, vars?: Vars): string;
  /**
   * Text written in English earlier (stored, or from a service): an exact entry, else a template
   * it fits, else as it is. Values captured by a template are translated too when they are entries.
   */
  text(english: string): string;
}

const cache = new Map<Catalog, Pattern[]>();

export function makeTranslator(lang: Language, catalog: Catalog): Translator {
  const lookup = (s: string) => (lang === 'en' ? undefined : catalog[s]);
  const t = ((english: string, vars?: Vars) =>
    fill(lookup(english) ?? english, vars)) as Translator;
  Object.defineProperty(t, 'lang', { value: lang });
  t.ctx = (context, english, vars) =>
    fill(lookup(`${context}|${english}`) ?? lookup(english) ?? english, vars);
  t.plural = (n, one, many, vars) => t(n === 1 ? one : many, { n, ...vars });
  const and = lang === 'es' ? ' y ' : ' and ';
  const or = lang === 'es' ? ' o ' : ' or ';
  /**
   * A value captured by a template: an entry (also written in lower case, as labels are inside
   * sentences: "products" → "productos"), a count of something ("12 products"), a list ("a, b and
   * c"), or text that fits a template itself.
   */
  const value = (v: string, depth: number): string => {
    const exact = catalog[v];
    if (exact !== undefined) return exact;
    if (v && v === v.toLowerCase()) {
      const cap = catalog[`${v[0]!.toUpperCase()}${v.slice(1)}`];
      if (cap !== undefined) return cap.toLowerCase();
    }
    const counted = /^(\d[\d,.]*) (\S.*)$/.exec(v);
    if (counted) {
      const noun = value(counted[2]!, depth);
      if (noun !== counted[2]) return `${counted[1]} ${noun}`;
    }
    if (/, | and | or /.test(v) && depth < 2) {
      const parts = v.split(/, | and | or /);
      const done = parts.map((x) => value(x, depth + 1));
      if (done.some((d, i) => d !== parts[i])) {
        const last = done.pop()!;
        return `${done.join(', ')}${/ or [^,]*$/.test(v) ? or : and}${last}`;
      }
    }
    if (depth < 2) {
      const inner = text(v, depth + 1);
      if (inner !== v) return inner;
    }
    return v;
  };
  const text = (english: string, depth = 0): string => {
    if (lang === 'en' || !english) return english;
    const exact = catalog[english];
    if (exact !== undefined) return exact;
    // Several sentences: translate each one, when that works.
    const parts = english.split(/(?<=[.!?])\s+(?=[A-Z“"(])/);
    if (parts.length > 1) {
      const done = parts.map((s) => text(s, depth));
      if (done.some((d, i) => d !== parts[i])) return done.join(' ');
    }
    let patterns = cache.get(catalog);
    if (!patterns) cache.set(catalog, (patterns = compile(catalog)));
    for (const p of patterns) {
      const m = p.re.exec(english);
      if (!m) continue;
      const vars: Vars = {};
      p.names.forEach((name, i) => {
        vars[name] = value(m[i + 1]!, depth);
      });
      return fill(p.to, vars);
    }
    return english;
  };
  t.text = (english: string) => text(english);
  return t;
}

/**
 * Marks English text written down before it's shown (a list of labels), so the catalog test finds
 * it. It returns the text unchanged: translate it where it's shown, with `t(label)`.
 */
export const msg = (english: string): string => english;
