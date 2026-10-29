import { expect, test } from '@playwright/test';

/**
 * M20: a Spanish-speaking owner, with no AI. Their browser asks for Spanish, so sign-up, the demo
 * shop's import, Home, insights and Ask are in Spanish; a question asked in Spanish is answered in
 * Spanish; switching "Tu idioma" to English turns the screens English for them alone.
 */
test.use({ locale: 'es-ES' });

test('a Spanish-speaking owner gets the app in Spanish, and can switch to English', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'mobile', 'One run of the Spanish journey is enough.');
  test.setTimeout(300_000);

  await page.goto('/sign-up');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await page.getByLabel('Tu nombre').fill('Lucía Prueba');
  await page
    .getByLabel('Correo')
    .fill(`es-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`);
  await page.getByLabel('Contraseña').fill('correct horse battery');
  await page.getByRole('button', { name: 'Crear mi cuenta' }).click();
  await expect(page).toHaveURL(/\/onboarding/);

  // The demo shop's messy (English) files, reviewed in Spanish.
  await page.getByRole('button', { name: 'Prueba la tienda demo' }).click();
  await expect(page.getByRole('heading', { name: 'Esto es lo que encontramos' })).toBeVisible({
    timeout: 120_000,
  });
  const bloom = page.getByTestId('review-question').filter({ hasText: 'Bloom' });
  await bloom.getByRole('button', { name: 'Sí, el mismo cliente' }).click();
  await expect(page.getByTestId('review-question').filter({ hasText: 'Bloom' })).toHaveCount(0, {
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Todo bien, prepáralo' }).click();
  await expect(page.getByRole('heading', { name: 'Tus datos están listos' })).toBeVisible({
    timeout: 120_000,
  });
  const base = page.url().replace(/\/data\/import.*$/, '');

  // Insights are filled from their facts with the pack's Spanish sentence.
  await page.goto(`${base}/insights`);
  const feed = page.getByRole('list', { name: 'Hallazgos' });
  await expect(async () => {
    await page.reload();
    await expect(feed).toContainText('se agotará', { timeout: 2_000 });
  }).toPass({ timeout: 90_000 });

  // A question in Spanish, answered in Spanish by the rules (no AI).
  await page.goto(`${base}/ask`);
  await page.getByLabel('Tu pregunta').fill('¿Cuánto vendí el mes pasado?');
  await page.getByLabel('Tu pregunta').press('Enter');
  const card = page.getByTestId('answer-card').last();
  await expect(card).toContainText('Ventas netas', { timeout: 30_000 });
  await card.getByText('Cómo lo calculé').click();
  await expect(card).toContainText('Abarca');

  // Their own language: English, in every business.
  await page.goto(`${base}/settings`);
  await page.getByLabel('Tu idioma').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto(`${base}/home`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
