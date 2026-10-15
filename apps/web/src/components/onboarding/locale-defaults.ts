import type { DateOrder } from '@bizr/db/schema';

const REGION_CURRENCY: Record<string, string> = {
  US: 'USD',
  GB: 'GBP',
  CA: 'CAD',
  AU: 'AUD',
  NZ: 'NZD',
  IN: 'INR',
  PK: 'PKR',
  AE: 'AED',
  SA: 'SAR',
  SG: 'SGD',
  ZA: 'ZAR',
  NG: 'NGN',
  KE: 'KES',
  PH: 'PHP',
  MY: 'MYR',
  BD: 'BDT',
  MX: 'MXN',
  BR: 'BRL',
  JP: 'JPY',
  IE: 'EUR',
  DE: 'EUR',
  FR: 'EUR',
  ES: 'EUR',
  IT: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  AT: 'EUR',
  PT: 'EUR',
  FI: 'EUR',
  GR: 'EUR',
  LU: 'EUR',
  SK: 'EUR',
  SI: 'EUR',
  EE: 'EUR',
  LV: 'EUR',
  LT: 'EUR',
  MT: 'EUR',
  CY: 'EUR',
  HR: 'EUR',
};

/** Best guesses from the browser; the owner can change every one of them. */
export function browserDefaults(): { currency: string; timezone: string; dateOrder: DateOrder } {
  let region: string | undefined;
  try {
    region = new Intl.Locale(navigator.language).maximize().region;
  } catch {
    region = undefined;
  }
  const parts = new Intl.DateTimeFormat(undefined).formatToParts(new Date(2026, 3, 3));
  const order = parts
    .filter((p) => p.type === 'day' || p.type === 'month' || p.type === 'year')
    .map((p) => p.type[0])
    .join('');
  const dateOrder: DateOrder = order === 'dmy' ? 'DMY' : order === 'ymd' ? 'YMD' : 'MDY';
  return {
    currency: (region && REGION_CURRENCY[region]) ?? 'USD',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    dateOrder,
  };
}

export function allTimezones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
}
