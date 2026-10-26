import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { chooseFiles } from './upload';

/** M11 (ADR-060): Plan ahead: the next weeks' estimate, a monthly goal, and the reorder list. */

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
let files: string[];

test.beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fernwood-plan-'));
  execFileSync('pnpm', ['--silent', 'demo:generate', '--today', today, '--out', dir], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  files = readdirSync(dir)
    .filter((f) => f !== 'ground_truth.json')
    .map((f) => path.join(dir, f));
});

test('an owner sees the weeks ahead, sets a goal and gets a reorder list', async ({
  page,
}, info) => {
  test.skip(
    info.project.name === 'mobile',
    'Same pages on phones; quality.spec checks the layout.',
  );
  test.setTimeout(240_000);
  await page.goto('/sign-up');
  await page.getByLabel('Your name').fill('Pat Planner');
  await page
    .getByLabel('Email')
    .fill(`plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`);
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

  await page.getByRole('link', { name: 'Plan ahead' }).first().click();
  await expect(page.getByRole('heading', { name: 'Plan ahead' })).toBeVisible();
  await expect(page.getByTestId('estimate-headline')).toContainText(
    /About \$[\d,]+, likely between/,
  );
  await expect(page.getByRole('list', { name: 'What this assumes' })).toContainText(
    'estimates, not promises',
  );

  // A monthly goal: wrong input explained, then saved and shown with where the month is heading.
  const goal = page.getByLabel('A monthly goal for net sales');
  await goal.fill('lots');
  await page.getByRole('button', { name: 'Save goal' }).first().click();
  await expect(page.getByText('Please enter the goal as a number')).toBeVisible();
  await goal.fill('12,000');
  await page.getByRole('button', { name: 'Save goal' }).first().click();
  const progress = page.getByTestId('goal-progress').first();
  await expect(progress).toContainText('so far:');
  await expect(progress).toContainText('of $12,000.00');
  await expect(progress).toContainText('Heading for about $');

  await page.goto(`${base}/home`);
  await expect(page.getByRole('region', { name: 'This month’s goals' })).toContainText('Net sales');

  // The reorder list, with the stock-out story's product, and its download.
  await page.goto(`${base}/plan`);
  await page.getByTestId('reorder-link').click();
  await expect(page.getByRole('heading', { name: 'What to reorder' })).toBeVisible();
  await expect(
    page.getByTestId('reorder-line').filter({ hasText: 'Sage Stoneware Mug' }),
  ).toBeVisible();
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'CSV' }).click(),
  ]);
  const text = readFileSync(await csv.path()).toString('utf8');
  expect(text).toContain('Suggested order');
  expect(text).toContain('Sage Stoneware Mug');
});
