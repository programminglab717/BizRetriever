// @ts-check
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Package boundaries (ADR-002). Lower layers must never import higher ones. */
const restrict = (files, patterns) => ({
  files,
  rules: {
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        patterns: patterns.map((group) => ({
          group: [group],
          message: 'Package boundary (ADR-002).',
        })),
      },
    ],
  },
});

export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    '**/.next/',
    '**/coverage/',
    '**/next-env.d.ts',
    '**/playwright-report/',
    '**/test-results/',
    'packages/db/migrations/',
    '.data/',
  ]),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/require-await': 'off',
      eqeqeq: ['error', 'smart'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // CLIs and scripts print to stdout on purpose.
    files: ['**/src/cli/**', '**/src/cli.ts', 'scripts/**', 'evals/runner/cli.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
    settings: { next: { rootDir: 'apps/web/' } },
  },
  restrict(['packages/**'], ['@bizr/web', '@bizr/web/*', '@bizr/worker', '@bizr/worker/*']),
  restrict(['packages/platform/**'], ['@bizr/*']),
  restrict(
    ['packages/db/**'],
    ['@bizr/core', '@bizr/core/*', '@bizr/ingest', '@bizr/ai', '@bizr/ai/*', '@bizr/packs'],
  ),
  restrict(
    ['packages/ai/**'],
    ['@bizr/db', '@bizr/db/*', '@bizr/core', '@bizr/core/*', 'pg', 'drizzle-orm', 'drizzle-orm/*'],
  ),
  restrict(
    ['packages/packs/**'],
    ['@bizr/db', '@bizr/db/*', '@bizr/core', '@bizr/core/*', '@bizr/ai', '@bizr/ai/*'],
  ),
  prettier,
]);
