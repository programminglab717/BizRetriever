import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * M13 (ADR-062): the owner adds someone who can only view; they look, leave a note, and change
 * nothing. The owner hands an insight to themselves, marks it done, then lets the viewer change
 * things after all.
 */

const email = (label: string) =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;

async function signUp(page: Page, name: string, address: string, next?: string) {
  await page.goto(next ? `/sign-up?next=${encodeURIComponent(next)}` : '/sign-up');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email').fill(address);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create my account' }).click();
}

async function demoShop(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await signUp(page, 'Olive Owner', email('owner'));
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole('button', { name: 'Try the demo shop' }).click();
  await expect(page.getByRole('heading', { name: 'Here’s what we found' })).toBeVisible({
    timeout: 120_000,
  });
  const bloom = page.getByTestId('review-question').filter({ hasText: 'Bloom' });
  await bloom.getByRole('button', { name: 'Yes, same customer' }).click();
  await expect(page.getByTestId('review-question').filter({ hasText: 'Bloom' })).toHaveCount(0, {
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Looks good, set it up' }).click();
  await expect(page.getByRole('heading', { name: 'Your data is ready' })).toBeVisible({
    timeout: 120_000,
  });
  const base = new URL(page.url()).pathname.replace(/\/data\/import\/.*$/, '');
  await page.goto(`${base}/home`);
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('list', { name: 'Insights' })).toContainText(
      'Sage Stoneware Mug will run out',
      { timeout: 2_000 },
    );
  }).toPass({ timeout: 90_000 });
  return { page, base };
}

test('a viewer looks and leaves notes; insights are handed to people and marked done', async ({
  browser,
}, info) => {
  test.skip(info.project.name === 'mobile', 'One journey across two people is enough.');
  test.setTimeout(360_000);
  const { page, base } = await demoShop(browser);

  // Invite someone who can only view.
  await page.goto(`${base}/settings`);
  const vera = email('viewer');
  await page.getByLabel('Email of the person to invite').fill(vera);
  await page.getByLabel('What they can do').selectOption('viewer');
  await page.getByRole('button', { name: 'Invite' }).click();
  const link = await page.getByLabel('Invitation link').inputValue();
  await expect(page.getByTestId('member-list')).toContainText('can view');

  const viewer = await (await browser.newContext()).newPage();
  const invite = new URL(link).pathname;
  await viewer.goto(invite);
  await expect(viewer.getByText(/but not change anything/)).toBeVisible();
  await signUp(viewer, 'Vera Viewer', vera, invite);
  await expect(viewer).toHaveURL(/\/invite\//);
  await viewer.getByRole('button', { name: 'Join' }).click();
  await expect(viewer).toHaveURL(/\/home$/);
  await expect(viewer.getByTestId('view-only')).toBeVisible();

  // They see the insights, can't dismiss them, and can leave a note.
  const mug = viewer
    .getByRole('list', { name: 'Insights' })
    .getByRole('listitem')
    .filter({ hasText: 'Sage Stoneware Mug will run out' });
  await mug.getByRole('button', { name: 'More options' }).click();
  await expect(viewer.getByRole('menuitem', { name: 'Dismiss' })).toHaveCount(0);
  await expect(viewer.getByRole('menuitem', { name: /Hand to/ })).toHaveCount(0);
  await mug.getByRole('button', { name: 'More options' }).click();
  await mug.getByRole('button', { name: /^Notes/ }).click();
  await mug.getByLabel('Add a note').fill('Supplier says the next batch ships Friday.');
  await mug.getByRole('button', { name: 'Add note' }).click();
  await expect(mug.getByRole('list', { name: 'Notes' })).toContainText(
    'Supplier says the next batch ships Friday.',
  );
  // M19: they mention the owner by picking the name after typing @.
  await mug.getByLabel('Add a note').pressSequentially('Can we order more? @Oli');
  await mug
    .getByRole('list', { name: 'Mention someone' })
    .getByRole('button', { name: '@Olive Owner' })
    .click();
  await expect(mug.getByLabel('Add a note')).toHaveValue('Can we order more? @Olive Owner ');
  await mug.getByRole('button', { name: 'Add note' }).click();
  await expect(mug.getByRole('list', { name: 'Notes' }).getByText('@Olive Owner')).toBeVisible();

  // Nothing to change for them elsewhere.
  await viewer.goto(`${base}/data/import`);
  await expect(viewer.getByTestId('view-only-note')).toBeVisible();
  await expect(viewer.getByText('Choose files')).toHaveCount(0);
  await viewer.goto(`${base}/dashboard`);
  await expect(viewer.getByTestId('dashboard-tile').first()).toBeVisible({ timeout: 30_000 });
  await expect(viewer.getByRole('region', { name: 'Dashboard changes' })).toHaveCount(0);

  // The owner sees the mention under For you, and says they've seen it.
  await page.goto(`${base}/home`);
  const mentions = page.getByRole('list', { name: 'Mentions' });
  await expect(mentions).toContainText('Vera Viewer mentioned you');
  await expect(mentions).toContainText('Can we order more? @Olive Owner');
  await mentions.getByRole('button', { name: 'Got it' }).click();
  await expect(mentions).toHaveCount(0);

  // The owner sees the notes, takes the insight on, and marks it done.
  const ownersMug = page
    .getByRole('list', { name: 'Insights' })
    .getByRole('listitem')
    .filter({ hasText: 'Sage Stoneware Mug will run out' });
  await ownersMug.getByRole('button', { name: 'Notes (2)' }).click();
  await expect(ownersMug).toContainText('Vera Viewer');
  await ownersMug.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('menuitem', { name: 'I’ll deal with it' }).click();
  const forYou = page.getByRole('list', { name: 'For you' });
  await expect(forYou).toContainText('Sage Stoneware Mug will run out');
  await expect(forYou.getByTestId('assigned')).toHaveText('For you');
  await forYou.getByRole('button', { name: 'Mark done' }).click();
  await expect(page.getByTestId('for-you')).toHaveCount(0);
  await page
    .getByRole('list', { name: 'Insights' })
    .getByRole('listitem')
    .filter({ hasText: 'Sage Stoneware Mug will run out' })
    .getByRole('button', { name: 'Notes (3)' })
    .click();
  await expect(page.getByText('Marked done.')).toBeVisible();

  // Let them change things after all.
  await page.goto(`${base}/settings`);
  await page.getByLabel('What Vera Viewer can do').selectOption('member');
  await expect(page.getByLabel('What Vera Viewer can do')).toHaveValue('member');
  await expect(async () => {
    await viewer.goto(`${base}/data/import`);
    await expect(viewer.getByTestId('view-only-note')).toHaveCount(0, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
});
