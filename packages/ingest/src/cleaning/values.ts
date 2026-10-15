import { cellText, isEmptyCell, type Cell } from '../grid';
import { parseDate, type DateOrder } from '../values/dates';
import { parseNumber } from '../values/numbers';
import { isNullSentinel } from '../values/text';
import type { Expr, ValueRule } from './rules';

/** A cleaned value, ready to load. Dates keep wall-clock parts; the loader applies the time zone. */
export interface DateValue {
  kind: 'date';
  date: string;
  time?: string;
  offsetMinutes?: number;
}
export type CleanValue = string | number | boolean | DateValue | null;

export type ValueResult = { ok: true; value: CleanValue } | { ok: false; reason: string };

export type TargetType =
  | 'text'
  | 'integer'
  | 'decimal'
  | 'money'
  | 'percent'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'reference';

export interface ValueContext {
  dateOrder: DateOrder;
}

const TRUE_VALUES = ['y', 'yes', 'true', '1', '✓', '✔', 'x', 'paid', 'done'];
const FALSE_VALUES = ['n', 'no', 'false', '0', '✗', 'unpaid', 'not paid'];

const ok = (value: CleanValue): ValueResult => ({ ok: true, value });
const fail = (reason: string): ValueResult => ({ ok: false, reason });

export function isDateValue(v: unknown): v is DateValue {
  return typeof v === 'object' && v !== null && (v as DateValue).kind === 'date';
}

function asText(v: Cell | CleanValue): string {
  if (v === null) return '';
  if (isDateValue(v)) return v.time ? `${v.date} ${v.time}` : v.date;
  if (v instanceof Date) return cellText(v);
  return String(v);
}

function quote(v: Cell | CleanValue): string {
  const t = asText(v);
  return `“${t.length > 40 ? `${t.slice(0, 39)}…` : t}”`;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase());
}

function applyRule(value: Cell | CleanValue, rule: ValueRule, ctx: ValueContext): ValueResult {
  if (value === null) return ok(null);
  switch (rule.rule) {
    case 'trim':
      return ok(typeof value === 'string' ? value.trim() : (value as CleanValue));
    case 'collapse_whitespace':
      return ok(
        typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : (value as CleanValue),
      );
    case 'case': {
      if (typeof value !== 'string') return ok(value as CleanValue);
      return ok(
        rule.to === 'upper'
          ? value.toUpperCase()
          : rule.to === 'lower'
            ? value.toLowerCase()
            : titleCase(value),
      );
    }
    case 'null_if': {
      const text = asText(value).trim().toLowerCase();
      return ok(
        rule.values.some((v) => v.trim().toLowerCase() === text) ? null : (value as CleanValue),
      );
    }
    case 'parse_number': {
      if (typeof value === 'number') return ok(value);
      const parsed = parseNumber(
        asText(value),
        rule.decimalSeparator ? { decimalSeparator: rule.decimalSeparator } : {},
      );
      if (!parsed) return fail(`couldn’t read ${quote(value)} as a number`);
      return ok(parsed.percent && rule.percent !== 'number' ? parsed.value / 100 : parsed.value);
    }
    case 'parse_date': {
      if (isDateValue(value)) return ok(value);
      const parsed = parseDate(
        value instanceof Date ? value : typeof value === 'number' ? value : asText(value),
        {
          dateOrder: rule.order ?? ctx.dateOrder,
          allowSerial: rule.allowSerial ?? typeof value === 'number',
        },
      );
      if (!parsed) return fail(`couldn’t read ${quote(value)} as a date`);
      const out: DateValue = { kind: 'date', date: parsed.date };
      if (parsed.time) out.time = parsed.time;
      if (parsed.offsetMinutes !== undefined) out.offsetMinutes = parsed.offsetMinutes;
      return ok(out);
    }
    case 'parse_boolean': {
      if (typeof value === 'boolean') return ok(value);
      const text = asText(value).trim().toLowerCase();
      const t = (rule.trueValues ?? TRUE_VALUES).map((v) => v.toLowerCase());
      const f = (rule.falseValues ?? FALSE_VALUES).map((v) => v.toLowerCase());
      if (t.includes(text)) return ok(true);
      if (f.includes(text)) return ok(false);
      return fail(`couldn’t read ${quote(value)} as yes or no`);
    }
    case 'strip_unit': {
      if (typeof value === 'number') return ok(value * (rule.factor ?? 1));
      const parsed = parseNumber(asText(value));
      if (!parsed) return fail(`couldn’t read ${quote(value)} as a number`);
      if (parsed.unit && !rule.units.map((u) => u.toLowerCase()).includes(parsed.unit)) {
        return fail(`unexpected unit “${parsed.unit}” in ${quote(value)}`);
      }
      return ok(parsed.value * (parsed.unit ? (rule.factor ?? 1) : 1));
    }
    case 'map_values': {
      const text = asText(value).trim().toLowerCase();
      const entry = Object.entries(rule.map).find(([k]) => k.trim().toLowerCase() === text);
      if (entry) return ok(entry[1]);
      const otherwise = rule.otherwise ?? 'keep';
      if (otherwise === 'null') return ok(null);
      if (otherwise === 'error') return fail(`${quote(value)} isn’t one of the expected values`);
      return ok(asText(value).trim());
    }
    case 'split_column': {
      const parts = asText(value).split(rule.delimiter);
      const part = parts[rule.part];
      return ok(part === undefined ? null : part.trim() || null);
    }
    case 'negate': {
      const n = typeof value === 'number' ? value : parseNumber(asText(value))?.value;
      if (n === undefined) return fail(`couldn’t read ${quote(value)} as a number`);
      return ok(-n);
    }
  }
}

/** Runs a field's value rules, then coerces to the target type (with sensible default parsing). */
export function cleanValue(
  cell: Cell,
  rules: readonly ValueRule[],
  type: TargetType,
  ctx: ValueContext,
): ValueResult {
  let value: Cell | CleanValue = cell;
  if (isEmptyCell(cell)) value = null;
  else if (typeof cell === 'string' && isNullSentinel(cell)) value = null;
  for (const rule of rules) {
    const r = applyRule(value, rule, ctx);
    if (!r.ok) return r;
    value = r.value;
  }
  return coerce(value, type, ctx);
}

export function coerce(value: Cell | CleanValue, type: TargetType, ctx: ValueContext): ValueResult {
  if (value === null || (typeof value === 'string' && value.trim() === '')) return ok(null);
  switch (type) {
    case 'text':
    case 'reference': {
      if (typeof value === 'number')
        return ok(Number.isInteger(value) ? String(value) : String(value));
      return ok(asText(value).replace(/\s+/g, ' ').trim());
    }
    case 'integer':
    case 'decimal':
    case 'money':
    case 'percent': {
      let n: number | undefined;
      if (typeof value === 'number') n = value;
      else if (typeof value === 'boolean' || isDateValue(value) || value instanceof Date)
        n = undefined;
      else {
        const parsed = parseNumber(asText(value));
        n = parsed
          ? parsed.percent && type === 'percent'
            ? parsed.value / 100
            : parsed.value
          : undefined;
      }
      if (n === undefined || !Number.isFinite(n))
        return fail(`couldn’t read ${quote(value)} as a number`);
      if (type === 'integer') {
        if (Math.abs(n - Math.round(n)) > 1e-9) return fail(`${quote(value)} isn’t a whole number`);
        return ok(Math.round(n));
      }
      return ok(Math.round(n * 10_000) / 10_000);
    }
    case 'date':
    case 'datetime': {
      let d: DateValue | undefined;
      if (isDateValue(value)) d = value;
      else {
        const r = applyRule(value, { rule: 'parse_date' }, ctx);
        if (!r.ok) return r;
        d = r.value as DateValue;
      }
      if (type === 'date') return ok({ kind: 'date', date: d.date });
      return ok(d);
    }
    case 'boolean': {
      if (typeof value === 'boolean') return ok(value);
      return applyRule(value, { rule: 'parse_boolean' }, ctx);
    }
  }
}

/** Evaluates a derived-value expression over a record's cleaned fields. Missing inputs → null. */
export function evalExpr(expr: Expr, fields: Readonly<Record<string, CleanValue>>): number | null {
  if ('const' in expr) return expr.const;
  if ('field' in expr) {
    const v = fields[expr.field];
    return typeof v === 'number' ? v : null;
  }
  if ('coalesce' in expr) {
    for (const e of expr.coalesce) {
      const v = evalExpr(e, fields);
      if (v !== null) return v;
    }
    return null;
  }
  const values = expr.args.map((a) => evalExpr(a, fields));
  if (values.some((v) => v === null)) return null;
  const nums = values as number[];
  let result: number;
  switch (expr.op) {
    case 'add':
      result = nums.reduce((a, b) => a + b, 0);
      break;
    case 'sub':
      result = nums.slice(1).reduce((a, b) => a - b, nums[0]!);
      break;
    case 'mul':
      result = nums.reduce((a, b) => a * b, 1);
      break;
    case 'div':
      if (nums.slice(1).some((d) => d === 0)) return null;
      result = nums.slice(1).reduce((a, b) => a / b, nums[0]!);
      break;
  }
  return Math.round(result * 10_000) / 10_000;
}
