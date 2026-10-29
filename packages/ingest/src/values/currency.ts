import { parseNumber } from './numbers';

/**
 * Which currency an amount is in (M20, ADR-070), from what files show: ISO codes ("EUR"), symbols
 * ("€", "£", "A$") and headers ("Price (EUR)"). "$" is the business's own dollar when its currency
 * is a dollar, otherwise US dollars; "¥" is yen unless the business uses yuan; "Rs" is the
 * business's rupee, else the Indian rupee.
 */

/** ISO 4217 codes we recognise in files. Converting needs a published rate as well. */
export const KNOWN_CURRENCIES = new Set([
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'NZD',
  'CHF',
  'JPY',
  'CNY',
  'HKD',
  'SGD',
  'INR',
  'PKR',
  'BDT',
  'LKR',
  'NPR',
  'AED',
  'SAR',
  'QAR',
  'KWD',
  'BHD',
  'OMR',
  'ZAR',
  'NGN',
  'KES',
  'GHS',
  'EGP',
  'MAD',
  'MXN',
  'BRL',
  'ARS',
  'CLP',
  'COP',
  'PEN',
  'UYU',
  'SEK',
  'NOK',
  'DKK',
  'ISK',
  'PLN',
  'CZK',
  'HUF',
  'RON',
  'BGN',
  'TRY',
  'ILS',
  'KRW',
  'TWD',
  'THB',
  'MYR',
  'IDR',
  'PHP',
  'VND',
]);

const DOLLARS = new Set(['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'MXN']);
const RUPEES = new Set(['INR', 'PKR', 'LKR', 'NPR']);

const SYMBOLS: Record<string, (business: string) => string> = {
  $: (b) => (DOLLARS.has(b) ? b : 'USD'),
  US$: () => 'USD',
  A$: () => 'AUD',
  AU$: () => 'AUD',
  C$: () => 'CAD',
  CA$: () => 'CAD',
  NZ$: () => 'NZD',
  S$: () => 'SGD',
  HK$: () => 'HKD',
  R$: () => 'BRL',
  '€': () => 'EUR',
  '£': () => 'GBP',
  '¥': (b) => (b === 'CNY' ? 'CNY' : 'JPY'),
  '₹': () => 'INR',
  Rs: (b) => (RUPEES.has(b) ? b : 'INR'),
  '₦': () => 'NGN',
  '₱': () => 'PHP',
  '৳': () => 'BDT',
  RM: () => 'MYR',
  KSh: () => 'KES',
  '₩': () => 'KRW',
  '₺': () => 'TRY',
  '₪': () => 'ILS',
  zł: () => 'PLN',
  kr: (b) => (['SEK', 'NOK', 'DKK', 'ISK'].includes(b) ? b : 'SEK'),
  Fr: () => 'CHF',
};

/** A code or symbol as written → its ISO code, or null when it isn't one. */
export function toCurrencyCode(text: string, business: string): string | null {
  const t = text.normalize('NFKC').trim();
  if (!t) return null;
  const upper = t.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper) && KNOWN_CURRENCIES.has(upper)) return upper;
  const symbol = SYMBOLS[t];
  return symbol ? symbol(business) : null;
}

/** A currency named in a column header: "Price (EUR)", "Amount €", "Total GBP". */
export function headerCurrency(header: string, business: string): string | null {
  const h = header.normalize('NFKC');
  const bracket = /[([]\s*([A-Za-z]{3}|[^\s\w()[\]]{1,3}|[A-Za-z]{1,3}\$)\s*[)\]]/.exec(h);
  if (bracket) {
    const c = toCurrencyCode(bracket[1]!, business);
    if (c) return c;
  }
  const words = h.split(/[\s/,:;_-]+/).filter(Boolean);
  for (const w of words) {
    if (/^[A-Z]{3}$/.test(w) && KNOWN_CURRENCIES.has(w)) return w;
    if (!/[A-Za-z0-9]/.test(w) || /^[A-Z]{0,3}\$$/.test(w)) {
      const c = toCurrencyCode(w, business);
      if (c) return c;
    }
  }
  return null;
}

/** A currency written in the value itself ("€12.50", "12.50 GBP"). */
export function cellCurrency(value: unknown, business: string): string | null {
  if (typeof value !== 'string') return null;
  const parsed = parseNumber(value);
  return parsed?.currency ? toCurrencyCode(parsed.currency, business) : null;
}

/** A column that says which currency each row is in. */
export function currencyColumn(header: string): boolean {
  return /^\s*(currency|curr|ccy|moneda|divisa|devise|währung|waehrung|valuta)(\s*(code|iso))?\s*$/i.test(
    header.normalize('NFKC'),
  );
}
