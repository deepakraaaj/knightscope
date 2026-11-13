// Renders public/icon.svg to the PNG sizes needed by the PWA manifest and native apps.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [192, 512, 1024]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:#0B1020">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `public/icon-${size}.png`, omitBackground: false });
}
await browser.close();
console.log('icons rendered');
