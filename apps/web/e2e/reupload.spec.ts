import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * M6 journey (PRODUCT_SPEC Journey 4): an owner who already brought their files in uploads next
 * month's website export → it's recognised → "Here's what would change" → update → undo.
 */

const repoRoot = path.resolve(import.meta.dirname, '../../..');
let files: string[];
let nextFile: string;
let truth: { added: string[]; cancelled: string[]; dropped: string[] };
const fmt = new Intl.NumberFormat('en-US');

test.beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fernwood-e2e-'));
  const next = mkdtempSync(path.join(tmpdir(), 'fernwood-next-e2e-'));
  execFileSync(
    'pnpm',
    ['--silent', 'demo:generate', '--today', '2026-10-13', '--out', dir, '--next-month', next],
    { cwd: repoRoot, stdio: 'ignore' },
  );
  files = readdirSync(dir)
    .filter((f) => f !== 'ground_truth.json')
    .map((f) => path.join(dir, f));
  nextFile = path.join(next, 'Online orders 2025-26.xlsx');
  truth = JSON.parse(
    readFileSync(path.join(next, 'next_month_truth.json'), 'utf8'),
  ) as typeof truth;
});

test('an owner uploads a newer export, sees what changes, updates and undoes', async ({ page }) => {
  test.setTimeout(300_000);
  const email = `reuploader-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  await page.goto('/sign-up');
  await page.getByLabel('Your name').fill('Sam Reuploader');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create my account' }).click();
  await page.getByLabel('What’s your business called?').fill(`Fernwood ${Date.now()}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/w\/[a-z0-9-]+\/home$/);
  const base = page.url().replace(/\/home$/, '');

  // First import.
  await page.goto(`${base}/data/import`);
  await page.getByTestId('file-input').setInputFiles(files);
  await page.getByRole('button', { name: 'Make sense of my data' }).click();
  await page.getByRole('button', { name: 'Looks good, set it up' }).click({ timeout: 120_000 });
  await expect(page.getByRole('heading', { name: 'Your data is ready' })).toBeVisible({
    timeout: 120_000,
  });

  // Next month's export.
  await page.goto(`${base}/data`);
  await page.getByRole('link', { name: 'Add or update files' }).click();
  await page.getByTestId('file-input').setInputFiles([nextFile]);
  await page.getByRole('button', { name: 'Make sense of my data' }).click();
  await expect(page.getByText('This looks like a newer version of').first()).toBeVisible({
    timeout: 120_000,
  });
  await page.getByRole('button', { name: 'Looks good, compare with my data' }).click();

  await expect(page.getByRole('heading', { name: 'Here’s what would change' })).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByTestId('merge-matches')).toContainText('Online orders 2025-26.xlsx');
  const sales = page.getByTestId('merge-sale');
  await expect(sales).toContainText(`${fmt.format(truth.added.length)} sales will be added`);
  await expect(sales).toContainText(`${fmt.format(truth.cancelled.length)} sales will be updated`);
  await expect(sales).toContainText('completed → cancelled');
  await expect(sales).toContainText(`${fmt.format(truth.dropped.length)} sales from last time`);
  await expect(sales).toContainText('We’ll keep them');

  await page.getByRole('button', { name: 'Update my data' }).click();
  await expect(page.getByRole('heading', { name: 'Your data is up to date' })).toBeVisible({
    timeout: 120_000,
  });
  const report = page.getByTestId('update-report');
  await expect(report).toContainText(`${fmt.format(truth.added.length)} new sales`);
  await expect(report).toContainText(`${fmt.format(truth.cancelled.length)} sales updated`);

  await page.getByRole('button', { name: 'Undo this update' }).click();
  await expect(page.getByRole('heading', { name: 'This update was undone' })).toBeVisible({
    timeout: 60_000,
  });
  await page.goto(`${base}/data`);
  await expect(page.getByText('Undone', { exact: true })).toBeVisible();
});
