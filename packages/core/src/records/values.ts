import type { FieldDef } from '../change-plan/schema';

/**
 * What someone typed into a cell, checked against the field's type (PRODUCT_SPEC §4.2): the value to
 * store (a parameter, never SQL), or a plain-language reason it can't be stored. Pure.
 */
export type EditValue = string | boolean | null;
export type ParsedEdit = { ok: true; value: EditValue } | { ok: false; error: string };

const MAX_TEXT = 2_000;

export function parseEditValue(field: FieldDef, raw: unknown): ParsedEdit {
  const label = field.label;
  const bad = (error: string): ParsedEdit => ({ ok: false, error });
  if (typeof raw === 'boolean' && field.type === 'boolean') return { ok: true, value: raw };
  const text = raw === null || raw === undefined ? '' : typeof raw === 'string' ? raw.trim() : '';
  if (typeof raw !== 'string' && raw !== null && raw !== undefined)
    return bad(`${label} can’t be set to that.`);
  if (text === '')
    return field.required ? bad(`${label} can’t be blank.`) : { ok: true, value: null };

  switch (field.type) {
    case 'text': {
      if (text.length > MAX_TEXT) return bad(`${label} is too long.`);
      if (field.allowedValues?.length) {
        const v = text.toLowerCase().replace(/[\s-]+/g, '_');
        if (!field.allowedValues.includes(v))
          return bad(`${label} must be one of: ${field.allowedValues.join(', ')}.`);
        return { ok: true, value: v };
      }
      return { ok: true, value: text };
    }
    case 'integer':
    case 'decimal':
    case 'money':
    case 'percent': {
      let s = text.replace(/[\s,$£€¥]/g, '');
      let negative = false;
      if (/^\(.*\)$/.test(s)) {
        negative = true;
        s = s.slice(1, -1);
      }
      const pct = field.type === 'percent' && s.endsWith('%');
      if (pct) s = s.slice(0, -1);
      if (!/^-?\d+(\.\d+)?$/.test(s)) return bad(`${label} must be a number.`);
      if (negative) s = s.startsWith('-') ? s.slice(1) : `-${s}`;
      if (field.type === 'integer') {
        if (s.includes('.')) return bad(`${label} must be a whole number.`);
        return { ok: true, value: String(BigInt(s)) };
      }
      if (pct) s = shiftDecimal(s, -2);
      const places = s.split('.')[1]?.length ?? 0;
      const max = field.type === 'percent' ? 6 : 4;
      if (places > max) return bad(`${label} can have at most ${max} decimal places.`);
      if ((s.split('.')[0]?.replace('-', '').length ?? 0) > 14)
        return bad(`${label} is too large.`);
      return { ok: true, value: s };
    }
    case 'date':
      return isRealDate(text) ? { ok: true, value: text } : bad(`${label} must be a real date.`);
    case 'datetime': {
      const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
      if (
        !m ||
        !isRealDate(m[1]!) ||
        Number(m[2]) > 23 ||
        Number(m[3]) > 59 ||
        Number(m[4] ?? 0) > 59
      )
        return bad(`${label} must be a real date and time.`);
      // Local time: the writer's session time zone is the workspace's.
      return { ok: true, value: `${m[1]}T${m[2]}:${m[3]}:${m[4] ?? '00'}` };
    }
    case 'boolean': {
      const v = text.toLowerCase();
      if (['true', 'yes', 'y', '1'].includes(v)) return { ok: true, value: true };
      if (['false', 'no', 'n', '0'].includes(v)) return { ok: true, value: false };
      return bad(`${label} must be yes or no.`);
    }
    case 'reference':
      // The id of the linked record, chosen from a search; the service checks it exists.
      return /^\d{1,18}$/.test(text)
        ? { ok: true, value: text }
        : bad(`Choose a ${label.toLowerCase()} from the list.`);
  }
}

function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3])
  );
}

/** Moves the decimal point (exactly, on the digits): shiftDecimal("15", -2) = "0.15". */
function shiftDecimal(s: string, by: number): string {
  const negative = s.startsWith('-');
  const [int = '', frac = ''] = s.replace('-', '').split('.');
  let digits = int + frac;
  let point = int.length + by;
  if (point <= 0) {
    digits = '0'.repeat(1 - point) + digits;
    point = 1;
  }
  const out = `${digits.slice(0, point)}.${digits.slice(point)}`
    .replace(/\.?0+$/, '')
    .replace(/^0+(?=\d)/, '');
  return `${negative ? '-' : ''}${out}`;
}

/** The detail a record is called by in lists: its name, else its code or number. Never personal details. */
export function titleFieldOf(fields: readonly FieldDef[]): string | undefined {
  const usable = fields.filter((f) => !f.pii && f.type === 'text');
  return (
    usable.find((f) => f.semantic === 'name')?.key ??
    usable.find((f) => f.semantic === 'identifier')?.key ??
    usable.find((f) => f.key === 'name' || f.key === 'title')?.key
  );
}
