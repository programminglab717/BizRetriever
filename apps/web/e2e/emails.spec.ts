import { expect, test } from '@playwright/test';

/** M9 (ADR-057): each person chooses their insight emails; a bad unsubscribe link changes nothing. */

test('a broken unsubscribe link says so, and its one-click post is refused', async ({
  page,
  request,
}) => {
  const q =
    'w=11111111-1111-4111-8111-111111111111&u=22222222-2222-4222-8222-222222222222&k=weekly_summary&t=forged';
  await page.goto(`/api/email/unsubscribe?${q}`);
  await expect(page).toHaveURL(/\/email\/unsubscribe\?/);
  await expect(page.getByText('This link doesn’t work')).toBeVisible();
  const r = await request.post(`/api/email/unsubscribe?${q}`, {
    form: { 'List-Unsubscribe': 'One-Click' },
  });
  expect(r.status()).toBe(400);
});

test('an owner turns the weekly summary email off and it stays off', async ({ page }) => {
  await page.goto('/sign-up');
  await page.getByLabel('Your name').fill('Robin Emails');
  await page
    .getByLabel('Email')
    .fill(`emails-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create my account' }).click();
  await page.getByLabel('What’s your business called?').fill(`Robin’s ${Date.now()}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/w\/[a-z0-9-]+\/home$/);
  const base = page.url().replace(/\/home$/, '');

  await page.goto(`${base}/insights/settings`);
  const emails = page.getByRole('region', { name: 'Emails to you' });
  await expect(emails).toContainText('Confirm your email address');
  const weekly = emails.getByRole('checkbox', { name: /^Weekly summary emails/ });
  await expect(weekly).toBeChecked();
  await weekly.uncheck();
  await expect(emails.getByRole('status')).toHaveText('Saved.');
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Emails to you' }).getByRole('checkbox', {
      name: /^Weekly summary emails/,
    }),
  ).not.toBeChecked();
  await expect(
    page.getByRole('region', { name: 'Emails to you' }).getByRole('checkbox', {
      name: /^Urgent alerts emails/,
    }),
  ).toBeChecked();
});
