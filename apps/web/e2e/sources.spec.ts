import { expect, test } from '@playwright/test';

/**
 * M10 (ADR-058): the "Link a Google Sheet" form explains a link it can't use, and nothing is linked.
 * The full linked-sheet journey (first import, automatic updates) is covered by the integration
 * test with Google's answers played back; e2e never reaches the network.
 */

test('a link that isn’t a Google Sheet is explained, not fetched', async ({ page }) => {
  await page.goto('/sign-up');
  await page.getByLabel('Your name').fill('Jo Sheets');
  await page
    .getByLabel('Email')
    .fill(`sources-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create my account' }).click();
  await page.getByLabel('What’s your business called?').fill(`Jo’s ${Date.now()}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/w\/[a-z0-9-]+\/home$/);
  const base = page.url().replace(/\/home$/, '');

  await page.goto(`${base}/data/import`);
  const link = page.getByLabel('Google Sheets link');
  await link.fill('https://example.com/my-sheet');
  await page.getByRole('button', { name: 'Link this sheet' }).click();
  await expect(page.getByText('That doesn’t look like a Google Sheets link')).toBeVisible();
  await page.goto(`${base}/data`);
  await expect(page.getByTestId('linked-source')).toHaveCount(0);
});
