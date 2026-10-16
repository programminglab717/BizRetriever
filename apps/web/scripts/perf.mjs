/**
 * M8 performance check: Largest Contentful Paint on the main pages (5 loads each) and the time from
 * asking to an answer for ten demo questions. Targets (PLAN M8): Home LCP ≤ 2 s, Ask p95 ≤ 6 s.
 * Tile query times come from app.query_run (origin `dashboard`).
 */
import { chromium } from '@playwright/test';
// Usage: pnpm perf <workspace-slug>   (signs in as DEMO_EMAIL / DEMO_PASSWORD against APP_URL)
const BASE = process.env.APP_URL ?? 'http://localhost:3000';
const SLUG = process.argv[2];
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {}),
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/sign-in`);
await page.getByLabel('Email').fill(process.env.DEMO_EMAIL ?? 'demo@fernwood.test');
await page.getByLabel('Password').fill(process.env.DEMO_PASSWORD ?? '');
await page.getByRole('button', { name: 'Sign in', exact: true }).click();
await page.waitForURL(/\/w\//);
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
};
async function lcp(url) {
  await page.goto(url, { waitUntil: 'load' });
  return page.evaluate(
    () =>
      new Promise((res) => {
        new PerformanceObserver((l) => {
          const e = l.getEntries();
          res(e[e.length - 1].startTime);
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        setTimeout(() => res(-1), 3000);
      }),
  );
}
const out = {};
for (const [name, path] of [
  ['home', 'home'],
  ['dashboard', 'dashboard'],
  ['insights', 'insights'],
  ['data', 'data'],
]) {
  const xs = [];
  for (let i = 0; i < 5; i++) xs.push(await lcp(`${BASE}/w/${SLUG}/${path}`));
  out[`${name} LCP ms (p50/max)`] = [Math.round(pct(xs, 0.5)), Math.round(Math.max(...xs))];
}
const qs = [
  'Which products made me the most profit last month?',
  'How much did I sell on Etsy this year compared with last year?',
  "What's about to run out?",
  'Which customers stopped ordering?',
  'How much money is tied up in stock that isn’t selling?',
  'What did I spend on ads this year?',
  'Net sales by channel by month',
  'Top 10 customers by spend this year',
  'Gross margin by category last quarter',
  'How many orders did I get last week?',
];
const times = [];
await page.goto(`${BASE}/w/${SLUG}/ask`);
for (const q of qs) {
  const before =
    (await page.getByTestId('answer-card').count()) +
    (await page.getByTestId('clarify-card').count());
  const t = Date.now();
  await page.getByLabel('Your question').fill(q);
  await page.getByLabel('Your question').press('Enter');
  await page.waitForFunction(
    (n) =>
      document.querySelectorAll('[data-testid="answer-card"],[data-testid="clarify-card"]').length >
      n,
    before,
    { timeout: 30000 },
  );
  times.push(Date.now() - t);
}
out['ask ms p50/p95/max'] = [pct(times, 0.5), pct(times, 0.95), Math.max(...times)];
console.log(JSON.stringify(out, null, 1));
await browser.close();
