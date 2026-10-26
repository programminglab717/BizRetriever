import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test, type Download } from '@playwright/test';

import { chooseFiles } from './upload';

/**
 * M9 downloads (ADR-056): an answer as CSV and Excel, a dashboard tile, and "Download all my data".
 * Files are checked as the browser saved them.
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

async function saved(download: Download): Promise<Buffer> {
  return readFileSync(await download.path());
}

test('downloads need a signed-in member', async ({ request }) => {
  const r = await request.get('/api/w/someone-else/data/download');
  expect(r.status()).toBe(404);
});

test('an owner downloads an answer, a tile and all their data', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'Same links on phones; checked once on desktop.');
  test.setTimeout(240_000);
  await page.goto('/sign-up');
  await page.getByLabel('Your name').fill('Sam Downloads');
  await page
    .getByLabel('Email')
    .fill(`downloads-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create my account' }).click();
  await page.getByLabel('What’s your business called?').fill(`Fernwood ${Date.now()}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/w\/[a-z0-9-]+\/home$/);
  const base = page.url().replace(/\/home$/, '');

  await page.goto(`${base}/data/import`);
  await chooseFiles(page, files);
  await page.getByRole('button', { name: 'Make sense of my data' }).click();
  await page.getByRole('button', { name: 'Looks good, set it up' }).click({ timeout: 120_000 });
  await expect(page.getByRole('heading', { name: 'Your data is ready' })).toBeVisible({
    timeout: 120_000,
  });

  // An answer, as CSV and as Excel.
  await page.goto(`${base}/ask`);
  await page.getByLabel('Your question').fill('Net sales by channel last month');
  await page.getByLabel('Your question').press('Enter');
  const card = page.getByTestId('answer-card').last();
  await expect(card).toContainText('Net sales', { timeout: 30_000 });
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    card.getByRole('link', { name: 'CSV' }).click(),
  ]);
  expect(csv.suggestedFilename()).toMatch(/^Net sales by .*\.csv$/);
  const text = (await saved(csv)).toString('utf8');
  expect(text.startsWith('\uFEFF')).toBe(true);
  expect(text).toContain('Net sales (USD)');
  const [xlsx] = await Promise.all([
    page.waitForEvent('download'),
    card.getByRole('link', { name: 'Excel' }).click(),
  ]);
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
  expect((await saved(xlsx)).subarray(0, 2).toString()).toBe('PK');

  // A dashboard tile, from its menu.
  await page.goto(`${base}/dashboard`);
  const tile = page.getByTestId('dashboard-tile').first();
  await expect(tile).toBeVisible({ timeout: 30_000 });
  await tile.getByRole('button', { name: /^Options for/ }).click();
  const [tileFile] = await Promise.all([
    page.waitForEvent('download'),
    tile.getByRole('menuitem', { name: 'Download as CSV' }).click(),
  ]);
  expect(tileFile.suggestedFilename()).toMatch(/\.csv$/);
  expect((await saved(tileFile)).length).toBeGreaterThan(10);

  // Everything, as one workbook.
  await page.goto(`${base}/data`);
  const [all] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-all').click(),
  ]);
  expect(all.suggestedFilename()).toMatch(/^Fernwood \d+ data\.xlsx$/);
  const bytes = await saved(all);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  expect(bytes.length).toBeGreaterThan(50_000);
});
