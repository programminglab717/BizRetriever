import { isSafeIdentifier } from '../sql/ident';

/** Physical table name for an entity key: product → products, sale_line → sale_lines, category → categories. */
export function tableNameFor(key: string): string {
  let name: string;
  if (/(s|x|z|ch|sh)$/.test(key)) name = `${key}es`;
  else if (/[^aeiou]y$/.test(key)) name = `${key.slice(0, -1)}ies`;
  else name = `${key}s`;
  if (!isSafeIdentifier(name)) throw new Error(`Unsafe table name for ${key}`);
  return name;
}

/** Physical columns for a field. Reference fields get an FK column plus the original text key. */
export function columnsFor(field: { key: string; type: string }): {
  value?: string;
  fk?: string;
  ref?: string;
} {
  if (field.type === 'reference') return { fk: `${field.key}_id`, ref: `${field.key}_ref` };
  return { value: field.key };
}

export const SQL_TYPES: Record<string, string> = {
  text: 'text',
  integer: 'bigint',
  decimal: 'numeric(18,4)',
  money: 'numeric(18,4)',
  percent: 'numeric(12,6)',
  date: 'date',
  datetime: 'timestamptz',
  boolean: 'boolean',
};

/** System columns every tenant table has (ADR-018). Field keys can't collide: they never start with "_". */
export const SYSTEM_COLUMNS = [
  '_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY',
  '_natural_key text',
  '_row_hash text',
  '_source_upload_id uuid',
  '_source_sheet text',
  '_source_row integer',
  '_created_at timestamptz NOT NULL DEFAULT now()',
  '_updated_at timestamptz NOT NULL DEFAULT now()',
  '_deleted_at timestamptz',
] as const;
