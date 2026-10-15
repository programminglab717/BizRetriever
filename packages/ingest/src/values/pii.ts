/** PII detection and masking for samples sent to the AI (ADR-020). */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type PiiKind = 'email' | 'phone' | 'card';

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function detectPii(value: string): PiiKind | undefined {
  const v = value.trim();
  if (EMAIL.test(v)) return 'email';
  const digits = v.replace(/\D/g, '');
  if (/^[\d\s-]+$/.test(v) && digits.length >= 13 && digits.length <= 19 && luhn(digits))
    return 'card';
  const dateLike = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(v);
  if (
    !dateLike &&
    /^[+(]?[\d\s().-]+$/.test(v) &&
    digits.length >= 7 &&
    digits.length <= 15 &&
    /[\s().+-]/.test(v)
  )
    return 'phone';
  return undefined;
}

/** Masks while keeping the shape, so the AI can still tell what kind of value it is. */
export function maskPii(value: string, kind: PiiKind): string {
  const v = value.trim();
  if (kind === 'email') {
    const [user = '', domain = ''] = v.split('@');
    const dot = domain.lastIndexOf('.');
    const host = dot > 0 ? domain.slice(0, dot) : domain;
    const tld = dot > 0 ? domain.slice(dot) : '';
    return `${user.slice(0, 1)}***@${host.slice(0, 1)}***${tld}`;
  }
  if (kind === 'card') return `•••• ${v.replace(/\D/g, '').slice(-4)}`;
  // Phone: keep separators and the last two digits.
  let seen = 0;
  const total = v.replace(/\D/g, '').length;
  return v.replace(/\d/g, (d) => (++seen > total - 2 ? d : '*'));
}

export function maskIfPii(value: string): string {
  const kind = detectPii(value);
  return kind ? maskPii(value, kind) : value;
}
