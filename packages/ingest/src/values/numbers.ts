/**
 * Lenient number parsing for messy spreadsheets: "$1,234.50", "(45.00)", "12.50 USD", "1.234,50",
 * "45 pcs", "12%", "−3". Returns undefined for anything that isn't clearly one number.
 */

export interface ParsedNumber {
  value: number;
  /** Currency symbol or ISO code seen in the text, e.g. "$" or "USD". */
  currency?: string;
  /** Unit word after the number, e.g. "pcs". */
  unit?: string;
  percent?: boolean;
}

export interface NumberOptions {
  /** Force the decimal separator; otherwise it is inferred per value (default "."). */
  decimalSeparator?: '.' | ',';
}

const CURRENCY_SYMBOLS = [
  '$',
  '£',
  '€',
  '¥',
  '₹',
  '₦',
  '₱',
  '৳',
  'R$',
  'US$',
  'HK$',
  'CA$',
  'AU$',
  'A$',
  'C$',
  'NZ$',
  'S$',
  'Rs',
  'RM',
  'KSh',
  '₩',
  '₺',
  '₪',
  'zł',
];
// The codes `values/currency.ts` knows (M20 added the rest).
const CURRENCY_CODES =
  /\b(USD|EUR|GBP|CAD|AUD|NZD|CHF|JPY|CNY|HKD|SGD|INR|PKR|BDT|LKR|NPR|AED|SAR|QAR|KWD|BHD|OMR|ZAR|NGN|KES|GHS|EGP|MAD|MXN|BRL|ARS|CLP|COP|PEN|UYU|SEK|NOK|DKK|ISK|PLN|CZK|HUF|RON|BGN|TRY|ILS|KRW|TWD|THB|MYR|IDR|PHP|VND)\b/i;
const UNIT_WORDS =
  /^(pcs?|pieces?|units?|ea|each|items?|boxes|box|bx|packs?|pk|sets?|pairs?|prs?|bottles?|cases?|cartons?|kg|kgs|g|gr|lbs?|oz|l|ltrs?|litres?|liters?|ml|m|cm|mm|dozen|doz|days?)\.?$/i;

/** Already-numeric cells pass straight through. */
export function parseNumber(input: unknown, options: NumberOptions = {}): ParsedNumber | undefined {
  if (typeof input === 'number') return Number.isFinite(input) ? { value: input } : undefined;
  if (typeof input !== 'string') return undefined;
  let text = input.normalize('NFKC').trim();
  if (text === '' || text.length > 40) return undefined;

  const result: Partial<ParsedNumber> = {};
  let negative = false;

  // Accounting negatives "(45.00)" and unicode minus.
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  text = text.replace(/[−–]/g, '-');

  const code = CURRENCY_CODES.exec(text);
  if (code) {
    result.currency = code[1]!.toUpperCase();
    text = text.replace(code[0], ' ').trim();
  }
  for (const symbol of [...CURRENCY_SYMBOLS].sort((a, b) => b.length - a.length)) {
    if (text.startsWith(symbol) || text.startsWith(`-${symbol}`) || text.endsWith(symbol)) {
      result.currency ??= symbol;
      text = text.replace(symbol, '').trim();
      break;
    }
  }

  if (text.endsWith('%')) {
    result.percent = true;
    text = text.slice(0, -1).trim();
  }

  // Payment terms written the trade way: "Net 30" is 30 days (M14).
  const net = /^net\s*(\d{1,3})$/i.exec(text);
  if (net) {
    result.unit = 'days';
    text = net[1]!;
  }

  const unitMatch = /^([-+]?[\d.,\s']+)\s*([A-Za-z]+\.?)$/.exec(text);
  if (unitMatch && UNIT_WORDS.test(unitMatch[2]!)) {
    result.unit = unitMatch[2]!.replace(/\.$/, '').toLowerCase();
    text = unitMatch[1]!.trim();
  }

  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1).trim();
  } else if (text.startsWith('+')) {
    text = text.slice(1).trim();
  }

  const value = parseDigits(text, options.decimalSeparator);
  if (value === undefined) return undefined;
  return { ...result, value: negative ? -value : value };
}

function parseDigits(text: string, forced?: '.' | ','): number | undefined {
  // Allow thousands separators: space, apostrophe, comma or dot.
  if (!/^\d[\d.,\s']*$/.test(text) && !/^[.,]\d+$/.test(text)) return undefined;
  const compact = text.replace(/[\s']/g, '');
  let decimal = forced;
  if (!decimal) {
    const lastDot = compact.lastIndexOf('.');
    const lastComma = compact.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) decimal = lastDot > lastComma ? '.' : ',';
    else if (lastComma >= 0) {
      // "1,234" is a thousands separator; "12,50" is a decimal comma.
      const groups = compact.split(',');
      decimal = groups.length === 2 && groups[1]!.length !== 3 ? ',' : '.';
    } else decimal = '.';
  }
  const thousands = decimal === '.' ? ',' : '.';
  const parts = compact.split(decimal);
  if (parts.length > 2) return undefined;
  const intPart = parts[0]!;
  // Thousands groups must be well-formed: 1,234,567 (not 12,34).
  if (intPart.includes(thousands)) {
    const groups = intPart.split(thousands);
    if (groups[0]!.length === 0 || groups[0]!.length > 3) return undefined;
    if (groups.slice(1).some((g) => g.length !== 3)) return undefined;
  }
  const normalized =
    intPart.split(thousands).join('') + (parts[1] !== undefined ? `.${parts[1]}` : '');
  if (!/^\d*\.?\d+$/.test(normalized) && !/^\d+\.?$/.test(normalized)) return undefined;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}
