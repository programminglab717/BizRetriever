import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * M6 journey (PRODUCT_SPEC §4.2): My data → a record type → search, change a detail inline (with
 * a type check and Undo), open a record, delete it and restore it from "Recently deleted".
 * On phones the same is done from the card list and the side panel.
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

test('an owner browses, edits, deletes and restores their records', async ({ page }, info) => {
  test.setTimeout(240_000);
  const mobile = info.project.name === 'mobile';
  const email = `records-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  await page.goto('/sign-up');
  await page.getByLabel('Your name').fill('Alex Records');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create my account' }).click();
  await page.getByLabel('What’s your business called?').fill(`Fernwood ${Date.now()}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/w\/[a-z0-9-]+\/home$/);
  const base = page.url().replace(/\/home$/, '');

  await page.goto(`${base}/data/import`);
  await page.getByTestId('file-input').setInputFiles(files);
  await page.getByRole('button', { name: 'Make sense of my data' }).click();
  await page.getByRole('button', { name: 'Looks good, set it up' }).click({ timeout: 120_000 });
  await expect(page.getByRole('heading', { name: 'Your data is ready' })).toBeVisible({
    timeout: 120_000,
  });

  // My data → Products.
  await page.getByRole('link', { name: 'Go to my data' }).click();
  await expect(page.getByTestId('records-product')).toContainText('95');
  await page.getByTestId('records-product').click();
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
  await expect(page.getByTestId('records-count')).toContainText('95 products');

  await page.getByLabel('Search products').fill('Sage');
  await expect(page).toHaveURL(/q=Sage/);
  await expect(page.getByTestId('records-count')).not.toContainText('95 products');

  if (!mobile) {
    // Inline edit in the grid: a bad value is explained, a good one saved, then undone.
    const row = page.getByTestId('record-row').first();
    const name = (await row.getByRole('rowheader').innerText()).trim();
    await row.getByRole('button', { name: `Change selling price of ${name}` }).click();
    const input = page.getByLabel('New selling price');
    await input.fill('lots');
    await input.press('Enter');
    await expect(page.getByText('Selling price must be a number.')).toBeVisible();
    await input.fill('99.50');
    await input.press('Enter');
    await expect(row).toContainText('$99.50');
    await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('status')).toContainText('Undone.');
    await expect(row).not.toContainText('$99.50');

    // Sort by clicking a header.
    await page.getByRole('button', { name: 'Sort by selling price' }).click();
    await expect(page).toHaveURL(/sort=unit_price&dir=asc/);
    await page.getByRole('rowheader').first().getByRole('button').click();
  } else {
    await page.getByTestId('records-cards').getByRole('button').first().click();
  }

  // The side panel: details, where it came from, history; change one here too.
  const panel = page.getByTestId('record-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('record-source')).toContainText('row');
  await panel.getByRole('button', { name: 'Change category' }).click();
  await panel.getByLabel('New category').fill('Gifts');
  await panel.getByLabel('New category').press('Enter');
  await expect(panel.getByTestId('record-history')).toContainText('Changed Category', {
    timeout: 15_000,
  });
  const title = (await panel.getByRole('heading', { level: 2 }).innerText()).trim();

  // Delete → Recently deleted → Restore.
  await panel.getByRole('button', { name: 'Delete' }).click();
  await panel.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(`Deleted ${title}.`);
  await expect(panel).toHaveCount(0);
  await page.getByRole('link', { name: 'Recently deleted' }).click();
  await expect(page.getByRole('heading', { name: 'Recently deleted products' })).toBeVisible();
  if (mobile) await page.getByTestId('records-cards').getByRole('button', { name: title }).click();
  else await page.getByRole('rowheader').getByRole('button', { name: title }).click();
  await page.getByTestId('record-panel').getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByRole('status')).toContainText(`Restored ${title}.`);
  await expect(page.getByText('Nothing was deleted in the last 30 days.')).toBeVisible();
  await page.getByRole('link', { name: 'Back to products' }).click();
  await expect(page.getByTestId('records-count')).toContainText('95 products');
});
