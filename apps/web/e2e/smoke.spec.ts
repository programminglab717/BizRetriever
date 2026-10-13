import { expect, test } from '@playwright/test';

test('home page renders the value proposition', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your business, explained.');
});

test('health check reports the database is up', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok', checks: { database: 'up' } });
});

test('job drain endpoint refuses unauthenticated calls', async ({ request }) => {
  const res = await request.post('/api/jobs/drain');
  expect([401, 503]).toContain(res.status());
});
