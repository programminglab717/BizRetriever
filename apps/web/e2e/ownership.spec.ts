import { expect, test, type Page } from '@playwright/test';

/** M19: the owner hands the business to a member; nothing changes until the member accepts. */

const email = (label: string) =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;

async function signUp(page: Page, name: string, address: string, next?: string) {
  await page.goto(next ? `/sign-up?next=${encodeURIComponent(next)}` : '/sign-up');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email').fill(address);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create my account' }).click();
}

test('the owner hands the business over, and it changes only when accepted', async ({
  browser,
}, info) => {
  test.skip(info.project.name === 'mobile', 'One journey across two people is enough.');
  test.setTimeout(120_000);
  const owner = await (await browser.newContext()).newPage();
  await signUp(owner, 'Olive Owner', email('owner'));
  const business = `Handover ${Date.now()}`;
  await owner.getByLabel('What’s your business called?').fill(business);
  await owner.getByRole('button', { name: 'Continue' }).click();
  await expect(owner).toHaveURL(/\/w\/[a-z0-9-]+\/home$/, { timeout: 30_000 });
  const base = new URL(owner.url()).pathname.replace(/\/home$/, '');

  await owner.goto(`${base}/settings`);
  const hal = email('member');
  await owner.getByLabel('Email of the person to invite').fill(hal);
  await owner.getByRole('button', { name: 'Invite' }).click();
  const invite = new URL(await owner.getByLabel('Invitation link').inputValue()).pathname;
  const member = await (await browser.newContext()).newPage();
  await signUp(member, 'Hal Helper', hal, invite);
  await member.getByRole('button', { name: 'Join' }).click();
  await expect(member).toHaveURL(/\/home$/);

  // Ask Hal to take over: the name must be typed.
  await owner.reload();
  const ask = owner.getByRole('button', { name: 'Ask them to take over' });
  await expect(ask).toBeDisabled();
  await owner.getByLabel('New owner').selectOption({ label: 'Hal Helper' });
  await owner.getByLabel(`Type “${business}” to hand it over`).fill(business);
  await ask.click();
  await expect(owner.getByTestId('handover-waiting')).toContainText(
    'Waiting for Hal Helper to accept',
  );

  // Hal sees it, and accepts in Settings.
  await member.goto(`${base}/home`);
  await member
    .getByTestId('takeover-home')
    .getByRole('link', { name: 'Answer in Settings' })
    .click();
  await expect(member.getByTestId('takeover')).toContainText(
    `Olive Owner wants to make you the owner of ${business}`,
  );
  await member.getByRole('button', { name: 'Become the owner' }).click();
  // The page refreshes into the owner's Settings.
  await expect(member.getByRole('heading', { name: 'Delete this business' })).toBeVisible();
  await expect(member.getByTestId('takeover')).toHaveCount(0);
  await expect(member.getByRole('heading', { name: 'Hand over this business' })).toBeVisible();

  // Olive is a member now: no owner's settings.
  await owner.reload();
  await expect(owner.getByRole('heading', { name: 'Hand over this business' })).toHaveCount(0);
  await expect(owner.getByRole('heading', { name: 'Delete this business' })).toHaveCount(0);
});
