import { expect, type Page } from '@playwright/test';

/**
 * Chooses files on the import page. Right after a navigation the page may not be interactive yet
 * (busy machine), and a file chosen before then is lost: choose again until the button wakes up.
 */
export async function chooseFiles(page: Page, files: string[]): Promise<void> {
  const button = page.getByRole('button', { name: 'Make sense of my data' });
  await expect(async () => {
    await page.getByTestId('file-input').setInputFiles(files);
    await expect(button).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
}
