import { expect, test } from '@playwright/test';

test('mobile layout: navigation and no horizontal overflow', async ({ page }) => {
  for (const route of ['', 'import', 'games', 'analysis', 'mistakes', 'training', 'analytics', 'settings']) {
    await page.goto(`./#/${route}`);
    await expect(page.locator('main')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on /${route}`).toBeLessThanOrEqual(1);
  }
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});
