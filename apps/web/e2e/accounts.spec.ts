import { expect, test, type Page } from '@playwright/test';

/** M1 journey: sign up → tell us about your business → app shell → settings → sign out/in → delete. */

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
}

async function signUp(page: Page, name: string, email: string, password: string) {
  await page.goto('/sign-up');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

async function createBusiness(page: Page, businessName: string) {
  await expect(page.getByRole('heading', { name: /tell us about your business/i })).toBeVisible();
  await page.getByLabel('What’s your business called?').fill(businessName);
  await expect(page.getByLabel(/Shop, online store or both/)).toBeChecked();
  await page.getByText('Day first').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/w\/[a-z0-9-]+\/home$/);
}

test.describe('accounts and workspaces', () => {
  test('an owner invites a member by link; members can’t invite or delete', async ({ browser }) => {
    const owner = await browser.newContext();
    const page = await owner.newPage();
    await signUp(page, 'Avery Owner', uniqueEmail('owner'), 'correct horse battery');
    await createBusiness(page, `Fernwood Team ${Date.now()}`);
    const base = page.url().replace(/\/home$/, '');
    await page.goto(`${base}/settings`);
    const friend = uniqueEmail('friend');
    await page.getByLabel('Email of the person to invite').fill(friend);
    await page.getByRole('button', { name: 'Invite' }).click();
    await expect(page.getByTestId('invite-sent')).toContainText(`Invitation ready for ${friend}.`);
    const link = await page.getByLabel('Invitation link').inputValue();
    await expect(page.getByTestId('member-list')).toContainText(friend);

    // The invited person opens the link, creates an account and joins.
    const guest = await browser.newContext();
    const them = await guest.newPage();
    await them.goto(new URL(link).pathname);
    await expect(them.getByRole('heading', { name: /^Join Fernwood Team/ })).toBeVisible();
    await them.getByRole('link', { name: 'Create an account' }).click();
    await them.getByLabel('Your name').fill('Sam Member');
    await them.getByLabel('Email').fill(friend);
    await them.getByLabel('Password').fill('correct horse battery');
    await them.getByRole('button', { name: 'Create my account' }).click();
    await expect(them).toHaveURL(/\/invite\//);
    await them.getByRole('button', { name: 'Join' }).click();
    await expect(them).toHaveURL(/\/w\/[a-z0-9-]+\/home$/);
    await them.goto(`${new URL(them.url()).pathname.replace(/\/home$/, '')}/settings`);
    await expect(them.getByText('Only the owner can invite people.')).toBeVisible();
    await expect(them.getByRole('button', { name: 'Delete this business forever' })).toHaveCount(0);

    // The link works once.
    const third = await (await browser.newContext()).newPage();
    await third.goto(new URL(link).pathname);
    await expect(third.getByText('This invitation has already been used.')).toBeVisible();

    // The owner sees them and can remove them.
    await page.reload();
    const row = page
      .getByTestId('member-list')
      .getByRole('listitem')
      .filter({ hasText: 'Sam Member' });
    await row.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByTestId('member-list')).not.toContainText('Sam Member');
    await owner.close();
    await guest.close();
  });

  test('a new owner can sign up, set up a business, use the app and delete it', async ({
    page,
  }) => {
    const email = uniqueEmail('owner');
    const password = 'correct horse battery';
    const business = `Fernwood Home ${Date.now()}`;

    await signUp(page, 'Avery Owner', email, password);
    await createBusiness(page, business);
    await expect(page.getByRole('heading', { name: 'Welcome, Avery' })).toBeVisible();
    await expect(page.getByText('Let’s bring in your data')).toBeVisible();
    const homeUrl = page.url();

    // Main navigation works (sidebar on desktop, bottom tabs on phones).
    await page.getByRole('link', { name: 'Ask', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Ask anything about your business' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // Settings: the choices from onboarding are saved and can be changed.
    await page.goto(homeUrl.replace(/\/home$/, '/settings'));
    await expect(page.getByLabel('Day first')).toBeChecked();
    await page.getByLabel('Business name').fill(`${business} Ltd`);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    // Sign out, then back in: we land on the business again.
    await page.goto(homeUrl.replace(/\/home$/, '/more'));
    await page.getByRole('main').getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto(homeUrl);
    await expect(page).toHaveURL(/\/sign-in\?next=/);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(homeUrl);

    // Delete needs the exact name typed.
    await page.goto(homeUrl.replace(/\/home$/, '/settings'));
    const deleteButton = page.getByRole('button', { name: 'Delete this business forever' });
    await expect(deleteButton).toBeDisabled();
    await page.getByLabel(/^Type “/).fill(`${business} Ltd`);
    await deleteButton.click();
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test('wrong passwords and taken emails get plain-language errors', async ({ page }) => {
    const email = uniqueEmail('dupe');
    await signUp(page, 'Dee Dupe', email, 'a very good password');
    await page.context().clearCookies();

    await page.goto('/sign-up');
    await page.getByLabel('Your name').fill('Someone Else');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('another good password');
    await page.getByRole('button', { name: 'Create my account' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      'That email already has an account',
    );

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('not the password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('don’t match');
  });

  test("people can't open a business they don't belong to", async ({ browser }) => {
    const owner = await browser.newContext();
    const ownerPage = await owner.newPage();
    await signUp(ownerPage, 'Olive Owner', uniqueEmail('olive'), 'a very good password');
    await createBusiness(ownerPage, `Olive's Shop ${Date.now()}`);
    const privateUrl = ownerPage.url();

    const stranger = await browser.newContext();
    const strangerPage = await stranger.newPage();
    await signUp(strangerPage, 'Sam Stranger', uniqueEmail('sam'), 'a very good password');
    const response = await strangerPage.goto(privateUrl);
    expect(response?.status()).toBe(404);
    await owner.close();
    await stranger.close();
  });

  test('signed-out visitors are sent to sign in', async ({ page }) => {
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fonboarding/);
  });
});
