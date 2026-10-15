/**
 * The single place where SQL identifiers are validated and quoted (CLAUDE.md, coding conventions).
 * Every schema, table, column and role name that reaches SQL text goes through `ident()`.
 * Values never go through here: they are always bound parameters.
 */

const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export class UnsafeIdentifierError extends Error {
  constructor(readonly identifier: string) {
    super(`Unsafe SQL identifier: ${JSON.stringify(identifier)}`);
  }
}

/** True for lowercase snake_case names of at most 63 characters (Postgres' limit). */
export function isSafeIdentifier(name: string): boolean {
  return SAFE_IDENTIFIER.test(name);
}

/**
 * Validates and double-quotes an identifier. We only ever generate lowercase snake_case names, so
 * anything else (quotes, spaces, unicode, uppercase) is rejected rather than escaped.
 */
export function ident(name: string): string {
  if (!isSafeIdentifier(name)) throw new UnsafeIdentifierError(name);
  return `"${name}"`;
}

/** `schema.name`, both parts validated. */
export function qualified(schema: string, name: string): string {
  return `${ident(schema)}.${ident(name)}`;
}
