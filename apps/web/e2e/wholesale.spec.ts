import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { chooseFiles } from './upload';

/**
 * M14: a wholesaler signs up as one, brings in their invoices, customer accounts, payments, stock and
 * purchase orders with no AI, and sees their own key numbers, alerts and answers.
 */

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
let files: string[];

test.beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'harbour-e2e-'));
  execFileSync(
    'pnpm',
    ['--silent', 'demo:generate', '--pack', 'wholesale', '--today', today, '--out', dir],
    { cwd: repoRoot, stdio: 'ignore' },
  );
  files = readdirSync(dir)
    .filter((f) => f !== 'ground_truth.json')
    .map((f) => path.join(dir, f));
});

test('a wholesaler brings in their files and sees money owed, credit limits and backorders', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'mobile', 'The full import journey runs once, on desktop.');
  test.setTimeout(300_000);
  await page.goto('/sign-up');
  await page.getByLabel('Your name').fill('Harper Wholesaler');
  await page
    .getByLabel('Email')
    .fill(`harbour-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create my account' }).click();
  await page.getByLabel('What’s your business called?').fill(`Harbour & Pine ${Date.now()}`);
  await page.getByLabel(/I sell to other businesses/).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/w\/[a-z0-9-]+\/home$/);
  const base = new URL(page.url()).pathname.replace(/\/home$/, '');

  // The import page speaks wholesale.
  await page.goto(`${base}/data/import`);
  await expect(page.getByText('Your customer list')).toBeVisible();
  await chooseFiles(page, files);
  await page.getByRole('button', { name: 'Make sense of my data' }).click();
  await expect(page.getByRole('heading', { name: 'Here’s what we found' })).toBeVisible({
    timeout: 120_000,
  });
  const summary = page.getByTestId('review-summary');
  await expect(summary).toContainText('invoices');
  await expect(summary).toContainText('16 customers');
  await expect(page.getByTestId('entity-payment')).toContainText('payments received');
  await page.getByRole('button', { name: 'Looks good, set it up' }).click();
  await expect(page.getByRole('heading', { name: 'Your data is ready' })).toBeVisible({
    timeout: 120_000,
  });

  // Home: the pack's key numbers and its alerts (the checks ran at the end of the import).
  await page.goto(`${base}/home`);
  const feed = page.getByRole('list', { name: 'Insights' });
  await expect(async () => {
    await page.reload();
    await expect(feed).toContainText('Corner Bloom Café owes you', { timeout: 2_000 });
  }).toPass({ timeout: 90_000 });
  await expect(page.getByRole('region', { name: 'Key numbers' })).toContainText(
    'Money owed to you',
  );

  // All insights: the other wholesale stories.
  await page.goto(`${base}/insights`);
  const all = page.getByRole('list', { name: 'Insights' });
  await expect(all).toContainText('Driftwood Deli is taking longer to pay');
  await expect(all).toContainText('Seaside Bakehouse usually orders every');
  await expect(all).toContainText('Oat Milk Barista 1L are still to send');

  // Ask, rules only.
  await page.goto(`${base}/ask`);
  await page.getByLabel('Your question').fill('Who is over their credit limit?');
  await page.getByLabel('Your question').press('Enter');
  const card = page.getByTestId('answer-card').last();
  await expect(card).toContainText('Corner Bloom Café', { timeout: 30_000 });

  // The dashboard is the wholesaler's.
  await page.goto(`${base}/dashboard`);
  const tiles = page.getByTestId('dashboard-tile');
  await expect(tiles.filter({ hasText: 'Who owes you' })).toBeVisible({ timeout: 30_000 });
  await expect(tiles.filter({ hasText: 'Still to send' })).toBeVisible();
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});
