import { parse } from 'libpg-query';

import { ident, isSafeIdentifier, qualified } from '../sql/ident';

/**
 * The SQL fallback validator (AI_DESIGN §6, safety rule 1). AI-written SQL is only ever run if it
 * parses with the real Postgres parser into exactly one SELECT whose every node, function, cast,
 * relation and column passes an allowlist. Anything not explicitly allowed is rejected.
 *
 * Accepted SQL is rewritten so every business relation it reads is shadowed by a CTE over the real
 * table (schema-qualified) that drops deleted records and hides internal columns. It then still runs
 * through the executor: READ ONLY, as the tenant's reader role, with a timeout and a row cap.
 */

export interface SqlScope {
  tenantSchema: string;
  /** Relations the SQL may read, with the columns it may see. */
  relations: ReadonlyMap<string, { kind: 'table' | 'view'; columns: readonly string[] }>;
}

export type SqlValidation =
  { ok: true; sql: string; relations: string[] } | { ok: false; reason: string };

export const LIMITS = { maxLength: 20_000, maxNodes: 2_000, maxDepth: 20 } as const;

/** AST node types that may appear. Everything else (ParamRef, LockingClause, …) is refused. */
const NODE_TYPES = new Set([
  'SelectStmt',
  'ResTarget',
  'ColumnRef',
  'String',
  'A_Const',
  'A_Star',
  'A_Expr',
  'BoolExpr',
  'FuncCall',
  'TypeCast',
  'RangeVar',
  'JoinExpr',
  'SortBy',
  'CommonTableExpr',
  'SubLink',
  'NullTest',
  'BooleanTest',
  'CaseExpr',
  'CaseWhen',
  'CoalesceExpr',
  'MinMaxExpr',
  'RangeSubselect',
  'RangeFunction',
  'SQLValueFunction',
  'List',
  'A_ArrayExpr',
  'RowExpr',
]);

const FUNCTIONS = new Set([
  // aggregates
  'sum',
  'count',
  'avg',
  'min',
  'max',
  'string_agg',
  'array_agg',
  'bool_and',
  'bool_or',
  'percentile_cont',
  'percentile_disc',
  'stddev',
  'variance',
  // dates
  'date_trunc',
  'date_part',
  'extract',
  'now',
  'age',
  'make_date',
  'make_interval',
  'to_char',
  'timezone',
  // maths
  'round',
  'floor',
  'ceil',
  'ceiling',
  'abs',
  'mod',
  'power',
  'nullif',
  'coalesce',
  'greatest',
  'least',
  // text
  'lower',
  'upper',
  'btrim',
  'ltrim',
  'rtrim',
  'length',
  'char_length',
  'substring',
  'substr',
  'position',
  'strpos',
  'concat',
  'concat_ws',
  'replace',
  'split_part',
  'left',
  'right',
  'initcap',
  // window
  'row_number',
  'rank',
  'dense_rank',
  'lag',
  'lead',
  'first_value',
  'last_value',
  'ntile',
  'percent_rank',
  'cume_dist',
]);

/** Set-returning functions allowed in FROM. */
const FROM_FUNCTIONS = new Set(['generate_series']);

const CASTS = new Set([
  'text',
  'varchar',
  'bpchar',
  'char',
  'int',
  'int2',
  'int4',
  'int8',
  'integer',
  'smallint',
  'bigint',
  'numeric',
  'decimal',
  'float4',
  'float8',
  'real',
  'date',
  'time',
  'timestamp',
  'timestamptz',
  'interval',
  'bool',
  'boolean',
]);

const OPERATORS = new Set([
  '=',
  '<>',
  '!=',
  '<',
  '>',
  '<=',
  '>=',
  '+',
  '-',
  '*',
  '/',
  '%',
  '||',
  '~~',
  '~~*',
  '!~~',
  '!~~*',
]);

const INTERNAL_COLUMN = /^_(row_hash|source_|deleted_at|natural_key)/;

class Rejected extends Error {}

type Node = Record<string, unknown>;

/** A string property of an AST node ('' when absent or not a string). */
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const names = (list: unknown): string[] =>
  Array.isArray(list)
    ? list.map((n) => {
        const s = (n as { String?: { sval?: string } }).String?.sval;
        if (typeof s !== 'string') throw new Rejected('unexpected name node');
        return s;
      })
    : [];

/** The function or type name, allowing only an optional `pg_catalog.` qualifier. */
function unqualified(parts: string[], what: string): string {
  if (parts.length === 1) return parts[0]!.toLowerCase();
  if (parts.length === 2 && parts[0]!.toLowerCase() === 'pg_catalog')
    return parts[1]!.toLowerCase();
  throw new Rejected(`qualified ${what} ${parts.join('.')}`);
}

function checkNode(
  type: string,
  node: Node,
  scope: SqlScope,
  ctes: Set<string>,
  used: Set<string>,
) {
  if (!NODE_TYPES.has(type)) throw new Rejected(`${type} isn't allowed`);
  switch (type) {
    case 'SelectStmt': {
      if (node.intoClause) throw new Rejected('SELECT INTO');
      if (node.lockingClause) throw new Rejected('locking clause');
      const w = node.withClause as { recursive?: boolean } | undefined;
      if (w?.recursive) throw new Rejected('recursive WITH');
      break;
    }
    case 'CommonTableExpr': {
      const name = str(node.ctename).toLowerCase();
      if (scope.relations.has(name)) throw new Rejected(`WITH name ${name} hides a table`);
      if (node.ctematerialized && node.ctematerialized !== 'CTEMaterializeDefault')
        throw new Rejected('materialization hint');
      break;
    }
    case 'RangeVar': {
      if (node.catalogname) throw new Rejected('catalog-qualified relation');
      // Qualified names (even the tenant's own schema) would bypass the shadow copies below.
      if (node.schemaname) throw new Rejected(`schema-qualified relation ${str(node.schemaname)}`);
      const rel = str(node.relname);
      if (ctes.has(rel.toLowerCase())) break;
      if (!scope.relations.has(rel)) throw new Rejected(`unknown relation ${rel}`);
      used.add(rel);
      break;
    }
    case 'ColumnRef': {
      const fields = node.fields as Node[] | undefined;
      if (!fields || fields.length > 2) throw new Rejected('column reference with too many parts');
      for (const f of fields) {
        const s = (f as { String?: { sval?: string } }).String?.sval;
        if (s !== undefined && INTERNAL_COLUMN.test(s)) throw new Rejected(`internal column ${s}`);
      }
      break;
    }
    case 'FuncCall': {
      const fn = unqualified(names(node.funcname), 'function');
      if (!FUNCTIONS.has(fn) && !FROM_FUNCTIONS.has(fn)) throw new Rejected(`function ${fn}`);
      if (node.agg_within_group && !['percentile_cont', 'percentile_disc'].includes(fn))
        throw new Rejected('WITHIN GROUP');
      if (node.func_variadic) throw new Rejected('VARIADIC');
      break;
    }
    case 'RangeFunction': {
      if (node.lateral) throw new Rejected('LATERAL function');
      if (node.ordinality || node.is_rowsfrom) throw new Rejected('ROWS FROM / ORDINALITY');
      const fns = (node.functions as Node[] | undefined) ?? [];
      for (const pair of fns) {
        const items = (pair as { List?: { items?: Node[] } }).List?.items ?? [];
        const call = (items[0] as { FuncCall?: Node } | undefined)?.FuncCall;
        const fn = call ? unqualified(names(call.funcname), 'function') : '';
        if (!FROM_FUNCTIONS.has(fn)) throw new Rejected(`function ${fn || '?'} in FROM`);
      }
      break;
    }
    case 'TypeCast': {
      const tn = node.typeName as { names?: unknown; arrayBounds?: unknown } | undefined;
      const t = unqualified(names(tn?.names), 'type');
      if (!CASTS.has(t)) throw new Rejected(`cast to ${t}`);
      if (tn?.arrayBounds) throw new Rejected('array cast');
      break;
    }
    case 'A_Expr': {
      const op = names(node.name);
      if (op.length !== 1) throw new Rejected('qualified operator');
      const kind = str(node.kind);
      if (['AEXPR_OP', 'AEXPR_OP_ANY', 'AEXPR_OP_ALL'].includes(kind) && !OPERATORS.has(op[0]!))
        throw new Rejected(`operator ${op[0]}`);
      if (kind === 'AEXPR_SIMILAR') throw new Rejected('SIMILAR TO');
      break;
    }
    case 'SubLink': {
      if (node.subLinkType === 'ARRAY_SUBLINK' || node.subLinkType === 'MULTIEXPR_SUBLINK')
        throw new Rejected(`${str(node.subLinkType)}`);
      break;
    }
  }
}

/**
 * The names of every CTE in the tree. A loop with its own stack, not recursion: it runs before the
 * depth limit is checked, so a very deep expression must not be able to overflow the call stack.
 */
export function collectCtes(root: unknown, out: Set<string>): void {
  const todo: unknown[] = [root];
  while (todo.length > 0) {
    const n = todo.pop();
    if (Array.isArray(n)) {
      todo.push(...(n as unknown[]));
      continue;
    }
    if (!n || typeof n !== 'object') continue;
    for (const [k, v] of Object.entries(n)) {
      if (k === 'CommonTableExpr') {
        const name = (v as { ctename?: string }).ctename;
        if (name) out.add(name.toLowerCase());
      }
      todo.push(v);
    }
  }
}

function walk(
  n: unknown,
  depth: number,
  state: { nodes: number },
  scope: SqlScope,
  ctes: Set<string>,
  used: Set<string>,
) {
  if (Array.isArray(n)) return n.forEach((x) => walk(x, depth, state, scope, ctes, used));
  if (!n || typeof n !== 'object') return;
  for (const [k, v] of Object.entries(n)) {
    let d = depth;
    if (/^[A-Z]/.test(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      state.nodes += 1;
      d = depth + 1;
      if (state.nodes > LIMITS.maxNodes) throw new Rejected('too complex');
      if (d > LIMITS.maxDepth) throw new Rejected('nested too deeply');
      checkNode(k, v as Node, scope, ctes, used);
    }
    walk(v, d, state, scope, ctes, used);
  }
}

/** Byte offset (as libpg_query reports) → JavaScript string index. */
function charIndex(sql: string, byteOffset: number): number {
  const bytes = Buffer.from(sql, 'utf8');
  return bytes.subarray(0, byteOffset).toString('utf8').length;
}

function shadow(scope: SqlScope, rel: string): string {
  const r = scope.relations.get(rel)!;
  const cols = r.columns.filter((c) => isSafeIdentifier(c)).map((c) => ident(c));
  const where = r.kind === 'table' ? ` WHERE "_deleted_at" IS NULL` : '';
  return `${ident(rel)} AS (SELECT ${cols.join(', ')} FROM ${qualified(scope.tenantSchema, rel)}${where})`;
}

export async function validateFallbackSql(sql: string, scope: SqlScope): Promise<SqlValidation> {
  try {
    if (sql.length > LIMITS.maxLength) throw new Rejected('too long');
    if (sql.includes(String.fromCharCode(0))) throw new Rejected('NUL character');
    let tree: { stmts?: { stmt: Node; stmt_location?: number; stmt_len?: number }[] };
    try {
      tree = (await parse(sql)) as typeof tree;
    } catch {
      throw new Rejected('doesn’t parse');
    }
    const stmts = tree.stmts ?? [];
    if (stmts.length !== 1) throw new Rejected(`${stmts.length} statements`);
    const { stmt, stmt_location: loc = 0, stmt_len: len = 0 } = stmts[0]!;
    const select = (stmt as { SelectStmt?: Node }).SelectStmt;
    if (!select) throw new Rejected(`${Object.keys(stmt)[0]} isn't a SELECT`);

    const ctes = new Set<string>();
    collectCtes(stmt, ctes);
    const used = new Set<string>();
    walk(stmt, 0, { nodes: 0 }, scope, ctes, used);

    // The statement text alone (drops a trailing semicolon).
    const bytes = Buffer.from(sql, 'utf8');
    const text = (len ? bytes.subarray(loc, loc + len) : bytes.subarray(loc)).toString('utf8');
    const shadows = [...used].sort().map((r) => shadow(scope, r));
    let rewritten = text;
    if (shadows.length > 0) {
      const w = select.withClause as { location?: number } | undefined;
      if (w) {
        const at = charIndex(text, (w.location ?? 0) - loc);
        if (text.slice(at, at + 4).toLowerCase() !== 'with') throw new Rejected('unexpected WITH');
        rewritten = `${text.slice(0, at)}WITH ${shadows.join(', ')}, ${text.slice(at + 4).trimStart()}`;
      } else {
        rewritten = `WITH ${shadows.join(', ')}\n${text}`;
      }
    }

    // Belt and braces: the rewrite must still be exactly one SELECT.
    const again = (await parse(rewritten)) as typeof tree;
    if (again.stmts?.length !== 1 || !(again.stmts[0]!.stmt as { SelectStmt?: unknown }).SelectStmt)
      throw new Rejected('rewrite changed the statement');
    return { ok: true, sql: rewritten, relations: [...used].sort() };
  } catch (err) {
    if (err instanceof Rejected) return { ok: false, reason: err.message };
    // Fail closed: anything too deep to look at is refused, never run.
    if (err instanceof RangeError) return { ok: false, reason: 'too complex' };
    throw err;
  }
}
