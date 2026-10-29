import type { FieldMeta } from '@bizr/core/records';
import type { Translator } from '@bizr/i18n/translate';

/** How a stored value reads in the records browser. Values arrive as text from the server. */
export function formatValue(
  field: FieldMeta,
  value: string | null,
  currency: string,
  t: Translator,
  locale = 'en-US',
): string {
  if (value === null || value === '') return '';
  switch (field.type) {
    case 'money': {
      const n = Number(value);
      return Number.isFinite(n)
        ? new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n)
        : value;
    }
    case 'decimal':
    case 'integer': {
      const n = Number(value);
      return Number.isFinite(n)
        ? new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(n)
        : value;
    }
    case 'percent': {
      const n = Number(value);
      return Number.isFinite(n)
        ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(n)
        : value;
    }
    case 'date': {
      const [y, m, d] = value.split('-').map(Number);
      if (!y || !m || !d) return value;
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
        new Date(Date.UTC(y, m - 1, d)),
      );
    }
    case 'datetime': {
      // Already in the business's local time: format the wall-clock reading as is.
      const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value);
      if (!m) return value;
      return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!)));
    }
    case 'boolean':
      return value === 'true' ? t('Yes') : value === 'false' ? t('No') : value;
    case 'text':
      return field.allowedValues?.length ? valueLabel(field, value, t) : value;
    default:
      return value;
  }
}

/** "online_store" → the pack's label ("Website"), else "Online store". */
export function valueLabel(field: FieldMeta, value: string, t: Translator): string {
  const named = field.valueLabels?.[value];
  if (named) return t.text(named);
  const s = value.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The value an editor starts with (what the person sees and changes). */
export function editorValue(field: FieldMeta, value: string | null): string {
  if (value === null) return '';
  if (field.type === 'datetime') return value.slice(0, 16);
  if (['money', 'decimal', 'integer'].includes(field.type)) {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : value;
  }
  if (field.type === 'percent') {
    const n = Number(value);
    return Number.isFinite(n) ? `${+(n * 100).toFixed(4)}%` : value;
  }
  return value;
}

export const isNumeric = (f: FieldMeta) =>
  f.type === 'money' || f.type === 'decimal' || f.type === 'integer' || f.type === 'percent';
