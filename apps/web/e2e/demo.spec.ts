import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/**
 * M8 rehearsal (DEMO_SCRIPT §2), with no AI: "Try the demo shop" → live import → Home insights →
 * Ask → dashboard edit → next month's file → start again. Each scene's time is recorded as an
 * annotation; the whole run must stay well inside the 7 minutes the script allows.
 */

const repoRoot = path.resolve(import.meta.dirname, '../../..');
// The demo shop is generated for today in its own time zone; next month's file must match.
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
let nextFile: string;

test.beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fernwood-demo-'));
  const next = mkdtempSync(path.join(tmpdir(), 'fernwood-demo-next-'));
  execFileSync(
    'pnpm',
    ['--silent', 'demo:generate', '--today', today, '--out', dir, '--next-month', next],
    { cwd: repoRoot, stdio: 'ignore' },
  );
  nextFile = path.join(next, 'Online orders 2025-26.xlsx');
});

async function signUp(page: Page, who: string) {
  await page.goto('/sign-up');
  await page.getByLabel('Your name').fill(who);
  await page
    .getByLabel('Email')
    .fill(`demo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page).toHaveURL(/\/onboarding/);
}

test('the investor demo runs end to end, in time, without AI', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'The rehearsal is the presenter’s laptop flow.');
  test.setTimeout(420_000);
  const started = Date.now();
  let mark = started;
  const scene = (name: string) => {
    const now = Date.now();
    info.annotations.push({
      type: 'scene',
      description: `${name}: ${((now - mark) / 1000).toFixed(1)}s`,
    });
    mark = now;
  };

  await signUp(page, 'Avery Presenter');
  scene('sign up');

  // Upload: the demo shop's messy files go in live.
  await page.getByRole('button', { name: 'Try the demo shop' }).click();
  await expect(page.getByRole('heading', { name: 'Here’s what we found' })).toBeVisible({
    timeout: 120_000,
  });
  const summary = page.getByTestId('review-summary');
  await expect(summary).toContainText('products');
  await expect(summary).toContainText('sales');
  scene('upload → here’s what we found');

  // The quick questions: Bloom & Co is one customer.
  const bloom = page.getByTestId('review-question').filter({ hasText: 'Bloom' });
  await bloom.getByRole('button', { name: 'Yes, same customer' }).click();
  await expect(page.getByTestId('review-question').filter({ hasText: 'Bloom' })).toHaveCount(0, {
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Looks good, set it up' }).click();
  await expect(page.getByRole('heading', { name: 'Your data is ready' })).toBeVisible({
    timeout: 120_000,
  });
  scene('questions → set up → data report');

  await page.getByRole('link', { name: 'See my dashboard' }).first().click();
  const tiles = page.getByTestId('dashboard-tile');
  await expect(tiles.filter({ hasText: 'Running low' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  const base = page.url().replace(/\/dashboard.*$/, '');
  scene('dashboard');

  // Proactive insights: the three the script reads out.
  await page.goto(`${base}/home`);
  const feed = page.getByRole('list', { name: 'Insights' });
  await expect(async () => {
    await page.reload();
    await expect(feed).toContainText('Sage Stoneware Mug will run out', { timeout: 2_000 });
  }).toPass({ timeout: 90_000 });
  await expect(feed.getByRole('listitem').first()).toContainText('Urgent');
  await page.goto(`${base}/insights`);
  const all = page.getByRole('list', { name: 'Insights' });
  await expect(all).toContainText('Bloom & Co’s orders dropped'.replace('’', "'"));
  await expect(all).toContainText('The cost of Linen Napkin Set went up 22%');
  scene('insights');

  // Ask: profit by product, then a question that needs clarifying, then pin it.
  await page.goto(`${base}/ask`);
  await page.getByLabel('Your question').fill('Which products made me the most profit last month?');
  await page.getByLabel('Your question').press('Enter');
  const card = page.getByTestId('answer-card').last();
  await expect(card).toContainText('Gross profit by product', { timeout: 30_000 });
  await card.getByText('How I calculated this').click();
  await expect(card).toContainText('Gross profit: Net sales − cost of goods sold.');
  await page.getByLabel('Your question').fill('Who are my best customers?');
  await page.getByLabel('Your question').press('Enter');
  const clarify = page.getByTestId('clarify-card');
  await clarify.getByRole('button', { name: 'How much they spend' }).click({ timeout: 30_000 });
  await expect(page.getByTestId('answer-card')).toHaveCount(2, { timeout: 30_000 });
  await page
    .getByTestId('answer-card')
    .last()
    .getByRole('button', { name: 'Add to dashboard' })
    .click();
  await expect(page.getByText('Added to your dashboard.')).toBeVisible();
  scene('ask');

  // Change the dashboard by chat.
  await page.goto(`${base}/dashboard`);
  await page.getByLabel('Change this dashboard').fill('Add a chart of sales by channel by month');
  await page.getByLabel('Change this dashboard').press('Enter');
  const preview = page.getByTestId('edit-preview');
  await expect(preview).toContainText('Add', { timeout: 30_000 });
  await preview.getByRole('button', { name: 'Apply' }).click();
  await expect(preview).toHaveCount(0, { timeout: 30_000 });
  scene('dashboard edit');

  // Keeping up to date: next month's export merges safely.
  await page.goto(`${base}/data`);
  await page.getByRole('link', { name: 'Add or update files' }).click();
  await page.getByTestId('file-input').setInputFiles([nextFile]);
  await page.getByRole('button', { name: 'Make sense of my data' }).click();
  await page
    .getByRole('button', { name: 'Looks good, compare with my data' })
    .click({ timeout: 120_000 });
  await expect(page.getByRole('heading', { name: 'Here’s what would change' })).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByTestId('merge-sale')).toContainText('sales will be added');
  await page.getByRole('button', { name: 'Update my data' }).click();
  await expect(page.getByRole('heading', { name: 'Your data is up to date' })).toBeVisible({
    timeout: 120_000,
  });
  scene('next month’s file');

  const total = (Date.now() - started) / 1000;
  info.annotations.push({ type: 'total', description: `${total.toFixed(1)}s` });
  // Machine time only: the presenter's talking comes on top, so keep a wide margin.
  expect(total).toBeLessThan(180);

  // Start again: a fresh copy replaces the old demo shop.
  await page.goto(`${base}/more`);
  await page.getByRole('button', { name: 'Start the demo shop again' }).click();
  await expect(page.getByRole('heading', { name: 'Here’s what we found' })).toBeVisible({
    timeout: 120_000,
  });
  await page.goto(page.url().replace(/\/data\/import\/.*$/, '/more'));
  await expect(
    page.getByRole('region', { name: 'Your businesses' }).getByRole('listitem'),
  ).toHaveCount(1);
});
