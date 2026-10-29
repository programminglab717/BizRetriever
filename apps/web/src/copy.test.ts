import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { findJargon } from '@bizr/core/narration';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Copy linter (PLAN M8, PRODUCT_SPEC §2): no jargon in what people read. It checks JSX text, the
 * attributes people see or hear (placeholder, aria-label, title, alt, label, description) and
 * sentence-like strings (error messages and the like) in every web source file. The internal admin
 * page is allowed to be technical.
 */

const SRC = path.join(import.meta.dirname);
const ALLOWED_FILES = [/app\/admin\//, /\.test\.tsx?$/];
const SHOWN_ATTRS = new Set(['placeholder', 'aria-label', 'title', 'alt', 'label', 'description']);
/** Strings a person really reads, deliberately technical. */
const ALLOWED_TEXT = [
  // Joining a business (the invite page) is everyday English, not a database join.
  /^Join$/,
  /^Join \{business\}$/,
  // A row of the owner's own spreadsheet ("orders.csv › Sheet1 › row 12").
  /^row \{n\}$/,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(f) ? [p] : [];
  });
}

const looksLikeSentence = (s: string) => /^[A-Z][^{}]*\s[^{}]*[.?!]$/.test(s.trim());

function shownText(file: string): { text: string; line: number }[] {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: { text: string; line: number }[] = [];
  const add = (text: string, node: ts.Node) => {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t) out.push({ text: t, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) add(node.text, node);
    else if (ts.isJsxAttribute(node) && SHOWN_ATTRS.has(node.name.getText()) && node.initializer) {
      const init = node.initializer;
      if (ts.isStringLiteral(init)) add(init.text, init);
      else if (
        ts.isJsxExpression(init) &&
        init.expression &&
        ts.isStringLiteralLike(init.expression)
      )
        add(init.expression.text, init);
    } else if (
      ts.isCallExpression(node) &&
      ((ts.isIdentifier(node.expression) && ['t', 'msg'].includes(node.expression.text)) ||
        (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'plural'))
    ) {
      // Translated text (M20): `t('…')`, `msg('…')`, `t.plural(n, '…', '…')`.
      for (const a of node.arguments) if (ts.isStringLiteralLike(a)) add(a.text, a);
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      !ts.isImportDeclaration(node.parent) &&
      !ts.isExportDeclaration(node.parent) &&
      looksLikeSentence(node.text)
    )
      add(node.text, node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe('copy', () => {
  it('uses no jargon in anything people read', () => {
    const problems: string[] = [];
    for (const file of files(SRC)) {
      const rel = path.relative(SRC, file);
      if (ALLOWED_FILES.some((r) => r.test(rel))) continue;
      for (const { text, line } of shownText(file)) {
        if (ALLOWED_TEXT.some((r) => r.test(text))) continue;
        const words = findJargon(text);
        if (words.length) problems.push(`${rel}:${line} "${text}" (${words.join(', ')})`);
      }
    }
    expect(problems).toEqual([]);
  });
});
