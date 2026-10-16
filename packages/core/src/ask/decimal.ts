/**
 * Exact arithmetic on decimal strings (money never goes through floats). Just what answers need:
 * differences and comparisons of values Postgres returned as `numeric`.
 */

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

function scaled(value: string, scale: number): bigint {
  const m = DECIMAL.exec(value.trim());
  if (!m) throw new Error(`Not a decimal: ${value}`);
  const frac = (m[3] ?? '').padEnd(scale, '0').slice(0, scale);
  const n = BigInt(`${m[2]}${frac}`);
  return m[1] ? -n : n;
}

const scaleOf = (v: string) => (v.split('.')[1] ?? '').length;

function unscale(n: bigint, scale: number): string {
  const neg = n < 0n;
  const digits = (neg ? -n : n).toString().padStart(scale + 1, '0');
  const int = digits.slice(0, digits.length - scale);
  const frac = scale ? digits.slice(-scale).replace(/0+$/, '') : '';
  return `${neg && /[1-9]/.test(digits) ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

export function isDecimal(v: string): boolean {
  return DECIMAL.test(v.trim());
}

/** a − b, exactly. */
export function decimalSub(a: string, b: string): string {
  const scale = Math.max(scaleOf(a), scaleOf(b));
  return unscale(scaled(a, scale) - scaled(b, scale), scale);
}

/** −1, 0 or 1. */
export function decimalCompare(a: string, b: string): number {
  const scale = Math.max(scaleOf(a), scaleOf(b));
  const d = scaled(a, scale) - scaled(b, scale);
  return d === 0n ? 0 : d < 0n ? -1 : 1;
}

export function decimalAbs(a: string): string {
  return a.trim().startsWith('-') ? a.trim().slice(1) : a.trim();
}
