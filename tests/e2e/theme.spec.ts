import { expect, test } from '@playwright/test';

test('theme toggle switches to light, persists across reloads, and can follow the system', async ({ page }) => {
  await page.goto('./#/');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(darkBg);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.goto('./#/settings');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('radio', { name: 'System' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.getByRole('radio', { name: 'Dark', exact: true }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
});
