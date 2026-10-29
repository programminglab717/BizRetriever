import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { catalogs } from '@bizr/i18n';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Everything people read is translated (M20, ADR-071). Text in the UI goes through `t()` (server:
 * `await getT()`, client: `useT()`), or `msg()` where it's written down before it's shown; every
 * such string needs a Spanish entry. JSX text, the attributes people see or hear, and sentences in
 * code must not be left bare. The internal admin page stays in English.
 */

const SRC = path.join(import.meta.dirname);
const ALLOWED_FILES = [
  /^app\/admin\//,
  /\.test\.tsx?$/,
  // The public API and MCP server answer developers and their tools, in English (docs/API.md).
  /^app\/api\/(v1|mcp)\//,
  /^lib\/api-key\.ts$/,
];
const SHOWN_ATTRS = new Set([
  'placeholder',
  'aria-label',
  'title',
  'alt',
  'label',
  'description',
  'hint',
  'pendingLabel',
  'confirmLabel',
]);
/** Text that is the same in every language. */
const SAME_EVERYWHERE =
  /^(BizRetriever|[^\p{L}]*|English|Español|CSV|PDF|Excel|Shopify|Google Sheets|QuickBooks|Xero|Square|WooCommerce|MCP|API|OK)$/u;
/** Calls whose sentences are for logs or developers, not people. */
const NOT_SHOWN_CALLS = /^(log|logger|getLogger\(.*\))\.(info|warn|error|debug)$|^console\./;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(f) ? [p] : [];
  });
}

/** Object properties whose values people read. */
const SHOWN_PROPS = new Set([
  'label',
  'title',
  'description',
  'message',
  'error',
  'formError',
  'hint',
  'placeholder',
  'text',
  'heading',
  'help',
  'empty',
  'userMessage',
  'question',
  'example',
  'detail',
  'summary',
  'body',
  'cta',
  'action',
]);

/** A string literal shown straight from JSX: `{busy ? 'Saving…' : 'Save'}`, `{x ?? 'None'}`. */
function shownFromJsx(node: ts.Node): boolean {
  let n = node.parent;
  while (
    n &&
    (ts.isConditionalExpression(n) ||
      ts.isParenthesizedExpression(n) ||
      (ts.isBinaryExpression(n) &&
        [
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
          ts.SyntaxKind.AmpersandAmpersandToken,
        ].includes(n.operatorToken.kind)))
  ) {
    if (ts.isConditionalExpression(n) && n.condition === node) return false;
    node = n;
    n = n.parent;
  }
  return Boolean(n && ts.isJsxExpression(n));
}

const looksLikeSentence = (s: string) => /^[A-Z][^{}]*\s[^{}]*[.?!…]$/.test(s.trim());
const hasLetters = (s: string) => /\p{L}/u.test(s);

/** The string arguments of `t(…)`, `t.plural(n, …, …)` and `msg(…)`. */
function keyArgs(call: ts.CallExpression): ts.Expression[] {
  const c = call.expression;
  if (ts.isIdentifier(c) && ['t', 'tr', 'msg'].includes(c.text)) return call.arguments.slice(0, 1);
  if (ts.isPropertyAccessExpression(c) && c.name.text === 'plural' && ts.isIdentifier(c.expression))
    return call.arguments.slice(1, 3);
  return [];
}

/** `t.ctx('button', 'Change')` reads the entry `button|Change`. */
function contextKey(call: ts.CallExpression): string | null {
  const c = call.expression;
  const [ctx, text] = call.arguments;
  if (
    ts.isPropertyAccessExpression(c) &&
    c.name.text === 'ctx' &&
    ctx &&
    text &&
    ts.isStringLiteralLike(ctx) &&
    ts.isStringLiteralLike(text)
  )
    return `${ctx.text}|${text.text}`;
  return null;
}

interface Found {
  bare: { text: string; line: number }[];
  keys: { text: string; line: number }[];
}

function scan(file: string): Found {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Found = { bare: [], keys: [] };
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const lines = src.split('\n');
  /** `// i18n-skip` on the line or the one above: deliberately English (for developers). */
  const skipped = (n: ts.Node) => {
    const l = lineOf(n);
    return /i18n-skip/.test(lines[l - 1] ?? '') || /i18n-skip/.test(lines[l - 2] ?? '');
  };
  const asKey = new Set<ts.Node>();
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const ck = contextKey(node);
      if (ck) {
        node.arguments.slice(0, 2).forEach((a) => asKey.add(a));
        found.keys.push({ text: ck, line: lineOf(node) });
      }
      for (const a of keyArgs(node)) {
        if (ts.isStringLiteralLike(a)) {
          asKey.add(a);
          found.keys.push({ text: a.text, line: lineOf(a) });
        }
      }
      if (NOT_SHOWN_CALLS.test(node.expression.getText())) return;
    }
    if (ts.isJsxText(node)) {
      const text = node.text.replace(/\s+/g, ' ').trim();
      if (text && hasLetters(text) && !SAME_EVERYWHERE.test(text) && !skipped(node))
        found.bare.push({ text, line: lineOf(node) });
    } else if (
      ts.isJsxAttribute(node) &&
      SHOWN_ATTRS.has(node.name.getText()) &&
      node.initializer
    ) {
      const init = node.initializer;
      const lit = ts.isStringLiteral(init)
        ? init
        : ts.isJsxExpression(init) && init.expression && ts.isStringLiteralLike(init.expression)
          ? init.expression
          : null;
      if (lit && hasLetters(lit.text) && !SAME_EVERYWHERE.test(lit.text) && !skipped(lit))
        found.bare.push({ text: lit.text, line: lineOf(lit) });
    } else if (
      ts.isStringLiteralLike(node) &&
      !asKey.has(node) &&
      !ts.isImportDeclaration(node.parent) &&
      !ts.isExportDeclaration(node.parent) &&
      !ts.isJsxAttribute(node.parent) &&
      hasLetters(node.text) &&
      !SAME_EVERYWHERE.test(node.text) &&
      !skipped(node) &&
      (looksLikeSentence(node.text) ||
        shownFromJsx(node) ||
        (ts.isPropertyAssignment(node.parent) &&
          node.parent.initializer === node &&
          SHOWN_PROPS.has(node.parent.name.getText()) &&
          /^[A-Z]/.test(node.text)))
    ) {
      found.bare.push({ text: node.text, line: lineOf(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const all = files(SRC)
  .map((file) => ({ rel: path.relative(SRC, file), file }))
  .filter(({ rel }) => !ALLOWED_FILES.some((r) => r.test(rel)))
  .map(({ rel, file }) => ({ rel, ...scan(file) }));

describe('translations', () => {
  it('leaves no text people read untranslated', () => {
    const bare = all.flatMap((f) => f.bare.map((b) => `${f.rel}:${b.line} "${b.text}"`));
    // I18N_DUMP=<file>: write the list out (handy when translating a lot at once).
    if (process.env.I18N_DUMP) writeFileSync(process.env.I18N_DUMP, bare.join('\n'));
    expect(bare).toEqual([]);
  });

  it('has a Spanish entry for every string the app translates', () => {
    const es = catalogs.es;
    // Core services write emails, files and answers with the same translator (M20).
    const core = path.join(SRC, '../../../packages/core/src');
    const coreKeys = files(core)
      .filter((f) => !/\.test\.ts$/.test(f))
      .map((file) => ({ rel: path.relative(SRC, file), ...scan(file) }));
    const missing = [...all, ...coreKeys].flatMap((f) =>
      f.keys.filter((k) => es[k.text] === undefined).map((k) => `${f.rel}:${k.line} "${k.text}"`),
    );
    expect(missing).toEqual([]);
  });
});
