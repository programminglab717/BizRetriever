import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * M8 polish checks on the demo shop, at the smallest phone we support (iPhone SE, 375 × 667):
 * no page scrolls sideways, and none has a serious or critical accessibility problem (axe).
 */

const PAGES = [
  'home',
  'ask',
  'dashboard',
  'insights',
  'insights/settings',
  'plan',
  'plan/reorder',
  'data',
  'data/product',
  'glossary',
  'history',
  'settings',
  'more',
];

test('every main page fits a small phone and passes the accessibility check', async ({
  browser,
}, info) => {
  test.skip(info.project.name === 'mobile', 'Runs once, at its own small-phone size.');
  test.setTimeout(300_000);
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto('/sign-up');
  await page.getByLabel('Your name').fill('Quinn Checker');
  await page
    .getByLabel('Email')
    .fill(`quality-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create my account' }).click();
  await page.getByRole('button', { name: 'Try the demo shop' }).click();
  await page.getByRole('button', { name: 'Looks good, set it up' }).click({ timeout: 120_000 });
  await expect(page.getByRole('heading', { name: 'Your data is ready' })).toBeVisible({
    timeout: 120_000,
  });
  const base = page.url().replace(/\/data\/import\/.*$/, '');

  const problems: string[] = [];
  for (const p of PAGES) {
    await page.goto(`${base}/${p}`);
    await page.waitForLoadState('networkidle');
    const { scroll, client, culprits } = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const wide = [...document.querySelectorAll('body *')]
        .filter((el) => el.children.length === 0 && el.getBoundingClientRect().right > vw + 1)
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()} “${(el.textContent ?? '').trim().slice(0, 30)}”`);
      return { scroll: document.documentElement.scrollWidth, client: vw, culprits: wide };
    });
    if (scroll > client + 1)
      problems.push(`${p}: ${scroll - client}px wider than the screen (${culprits.join(', ')})`);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    for (const v of axe.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical'))
      problems.push(
        `${p}: ${v.id} (${v.impact}) ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join(', ')}`,
      );
  }
  expect(problems).toEqual([]);
  await context.close();
});
