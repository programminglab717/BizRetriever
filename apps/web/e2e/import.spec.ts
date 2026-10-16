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
  await expect(page.getByRole('heading', { name: 'Measures (32)' })).toBeVisible();
  await expect(page.getByTestId('record-type-sale')).toContainText('5,571 records');
  await expect(page.getByTestId('record-type-sale')).toContainText('Sales are linked to customers');
  const netSales = page.getByTestId('measure-net_sales');
  await netSales.getByRole('button', { name: 'Rename Net sales' }).click();
  await netSales.getByLabel('New name for Net sales').fill('Takings');
  await netSales.getByRole('button', { name: 'Save' }).click();
  await expect(netSales).toContainText('Takings');
  await page.reload();
  await expect(page.getByTestId('measure-net_sales')).toContainText('Takings');

  // Ask (M4): a suggested question, a clarifying one, feedback and pinning. Rules only: no AI in tests.
  const base = page.url().replace(/\/glossary$/, '');
  await page.goto(`${base}/ask`);
  await expect(page.getByText('Ask me anything about your business.')).toBeVisible();
  await page
    .getByRole('button', { name: 'Which products made me the most profit last month?' })
    .click();
  const card = page.getByTestId('answer-card').last();
  await expect(card).toContainText('Gross profit by product', { timeout: 30_000 });
  await expect(card.locator('strong').first()).toBeVisible();
  await expect(card).toContainText('I took “profit” to mean gross profit');
  await card.getByRole('button', { name: 'Show as table' }).click();
  await expect(card.getByRole('table')).toBeVisible();
  await card.getByText('How I calculated this').click();
  await expect(card).toContainText('Gross profit: Net sales − cost of goods sold.');
  await card.getByRole('button', { name: 'Good answer' }).click();
  await expect(page.getByText('Thanks, that helps us get better.')).toBeVisible();
  await card.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect(page.getByText('Added to your dashboard.')).toBeVisible();

  await page.getByLabel('Your question').fill('Who are my best customers?');
  await page.getByLabel('Your question').press('Enter');
  const clarify = page.getByTestId('clarify-card');
  await expect(clarify).toContainText('how much they spend or how often they order', {
    timeout: 30_000,
  });
  await clarify.getByRole('button', { name: 'How much they spend' }).click();
  await expect(page.getByTestId('answer-card')).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByTestId('answer-card').last()).toContainText('by customer');

  // The conversation survives a reload, and the pinned answer is on the dashboard.
  await page.reload();
  await expect(page.getByTestId('answer-card')).toHaveCount(2);
  await page.goto(`${base}/dashboard`);
  const tiles = page.getByTestId('dashboard-tile');
  await expect(tiles.first()).toContainText('Gross profit by product');

  // Dashboard (M5): the pack's tiles were built at import, and follow the date range.
  await expect(tiles.filter({ hasText: 'Running low' })).toBeVisible();
  await expect(tiles.filter({ hasText: 'Sales by channel' })).toBeVisible();
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  await page.getByLabel('Date range').selectOption('this_year');
  await expect(page).toHaveURL(/range=this_year/);
  await expect(page.getByTestId('range-label')).toContainText(/\d{4}/);

  // Change it by chat: preview, apply, undo.
  await page.getByLabel('Change this dashboard').fill('Add a chart of sales by city');
  await page.getByLabel('Change this dashboard').press('Enter');
  const preview = page.getByTestId('edit-preview');
  await expect(preview).toContainText('Add “Takings by city”', { timeout: 30_000 });
  await preview.getByRole('button', { name: 'Apply' }).click();
  await expect(tiles.first()).toContainText('Takings by city', { timeout: 30_000 });
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(tiles.filter({ hasText: 'Takings by city' })).toHaveCount(0, { timeout: 30_000 });

  // And by hand: remove a tile from its menu.
  await page.getByRole('button', { name: 'Options for Top customers' }).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(tiles.filter({ hasText: 'Top customers' })).toHaveCount(0, { timeout: 30_000 });

  // Insights (M7): Home shows key numbers, the Ask box and what needs attention. The checks ran
  // at the end of the import (inline jobs), so give them a moment.
  await page.goto(`${base}/home`);
  const feed = page.getByRole('list', { name: 'Insights' });
  await expect(async () => {
    await page.reload();
    await expect(feed).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000 });
  await expect(page.getByRole('region', { name: 'Key numbers' })).toContainText('Takings');
  // Dead stock stays true whatever today's date: holiday candles don't sell after January.
  const dead = feed.getByRole('listitem').filter({ hasText: 'sold in 90 days' });
  await expect(dead).toBeVisible();
  await expect(dead.locator('strong').first()).toBeVisible();
  await dead.getByRole('button', { name: 'More options' }).click();
  await dead.getByRole('menuitem', { name: 'Dismiss' }).click();
  await expect(feed.getByRole('listitem').filter({ hasText: 'sold in 90 days' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('sold in 90 days')).toHaveCount(0);

  // The Ask box hands the question over.
  await page.getByLabel('Ask anything about your business').fill('Net sales by channel');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page).toHaveURL(/\/ask\?q=Net\+sales\+by\+channel/);

  // Alert settings: thresholds in plain words, saved per alert.
  await page.goto(`${base}/insights/settings`);
  const stock = page.locator('#stockout_risk');
  await expect(stock).toContainText('Warn me when stock will run out within');
  await stock.getByRole('spinbutton').first().fill('21');
  await stock.getByRole('button', { name: 'Save' }).click();
  await expect(stock.getByRole('status')).toContainText('Saved');
  await page.reload();
  await expect(page.locator('#stockout_risk').getByRole('spinbutton').first()).toHaveValue('21');

  // All insights, filtered by topic.
  await page.goto(`${base}/insights`);
  await page.getByRole('link', { name: 'Stock', exact: true }).click();
  await expect(page).toHaveURL(/category=stock/);
  await expect(page.getByRole('heading', { name: 'All insights' })).toBeVisible();
});
