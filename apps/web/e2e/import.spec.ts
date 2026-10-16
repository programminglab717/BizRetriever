import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * M2 journey (PRODUCT_SPEC Journey 1): upload the messy demo files → "Here's what we found" →
 * answer a question → set it up → data report. Runs with no AI (tests never call the live API).
 */

const repoRoot = path.resolve(import.meta.dirname, '../../..');
let files: string[];

test.beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fernwood-e2e-'));
  execFileSync('pnpm', ['--silent', 'demo:generate', '--today', '2026-10-13', '--out', dir], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  files = readdirSync(dir)
    .filter((f) => f !== 'ground_truth.json')
    .map((f) => path.join(dir, f));
});

test('an owner imports their messy spreadsheets and gets a data report', async ({ page }) => {
  test.setTimeout(240_000);
  const email = `importer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  await page.goto('/sign-up');
  await page.getByLabel('Your name').fill('Robin Importer');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create my account' }).click();
  await page.getByLabel('What’s your business called?').fill(`Fernwood ${Date.now()}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/w\/[a-z0-9-]+\/home$/);

  // Upload.
  await page.getByRole('link', { name: 'Upload files' }).click();
  await expect(page.getByRole('heading', { name: 'Bring in your files' })).toBeVisible();
  await page
    .getByTestId('file-input')
    .setInputFiles([...files, path.join(repoRoot, 'package.json')]);
  await expect(page.getByText('We can read Excel (.xlsx) and CSV files.')).toBeVisible();
  await page.getByRole('button', { name: 'Remove package.json' }).click();
  await page.getByRole('button', { name: 'Make sense of my data' }).click();

  // Processing → review.
  await expect(page.getByRole('heading', { name: 'Here’s what we found' })).toBeVisible({
    timeout: 120_000,
  });
  const summary = page.getByTestId('review-summary');
  await expect(summary).toContainText('95 products');
  await expect(summary).toContainText('5,571 sales');
  await expect(page.getByTestId('entity-product')).toContainText('95 products');
  await expect(page.getByText('Totals and subtotals')).toBeVisible();

  // Answer the duplicate-customer question: the screen updates with what changed.
  const bloom = page.getByTestId('review-question').filter({ hasText: 'Bloom' });
  await bloom.getByRole('button', { name: 'No, they’re different' }).click();
  await expect(page.getByText('What changed')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('You told us:')).toBeVisible();
  await expect(page.getByTestId('review-question').filter({ hasText: 'Bloom' })).toHaveCount(0);

  // Set it up → report.
  await page.getByRole('button', { name: 'Looks good, set it up' }).click();
  await expect(page.getByRole('heading', { name: 'Your data is ready' })).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByTestId('report-brought-in')).toContainText('5,571 sales');
  await expect(page.getByTestId('report-brought-in')).toContainText('95 products');

  // My data lists the import.
  await page.getByRole('link', { name: 'Go to my data' }).click();
  await expect(page.getByRole('heading', { name: 'My data' })).toBeVisible();
  await expect(page.getByText('Brought in', { exact: true })).toBeVisible();

  // What we track: every measure is available on the demo data, and names can be changed.
  await page.goto(page.url().replace(/\/data$/, '/glossary'));
  await expect(page.getByRole('heading', { name: 'What we track' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Measures (28)' })).toBeVisible();
  await expect(page.getByTestId('record-type-sale')).toContainText('5,571 records');
  await expect(page.getByTestId('record-type-sale')).toContainText('Sales are linked to customers');
  const netSales = page.getByTestId('measure-net_sales');
  await netSales.getByRole('button', { name: 'Rename Net sales' }).click();
  await netSales.getByLabel('New name for Net sales').fill('Takings');
  await netSales.getByRole('button', { name: 'Save' }).click();
  await expect(netSales).toContainText('Takings');
  await page.reload();
  await expect(page.getByTestId('measure-net_sales')).toContainText('Takings');
});
