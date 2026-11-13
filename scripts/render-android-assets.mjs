// Renders KnightScope launcher icons and splash screens for Android from the logo artwork.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const RES = 'android/app/src/main/res';
const BG = '#0B1020';
// Logo artwork (viewBox 0 0 64 64): ring + knight, without background.
const MARK = `<circle cx="32" cy="32" r="22" fill="none" stroke="#7C9CFF" stroke-width="3"/><path d="M24 46h18v-4l-3-2c0-6 3-9 3-15 0-6-5-10-11-10l-2 4-4 2-3 6 2 2 5-2 2 1c-4 4-7 8-7 13l-3 1z" fill="#F5F7FB"/><circle cx="29" cy="22" r="1.6" fill="${BG}"/>`;

const svg = (w, h, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;
// Place the 64-unit mark centred, scaled so it is `size` px wide.
const mark = (w, h, size) => `<g transform="translate(${(w - size) / 2} ${(h - size) / 2}) scale(${size / 64})">${MARK}</g>`;

const files = execSync(`ls ${RES}/mipmap-*dpi/*.png ${RES}/drawable*/splash.png`).toString().trim().split('\n');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const f of files) {
  const out = execSync(`python3 -c "from PIL import Image;print(*Image.open('${f}').size)"`).toString().trim().split(' ').map(Number);
  const [w, h] = out;
  let body;
  if (f.endsWith('ic_launcher_foreground.png')) {
    // Adaptive icon foreground: transparent, artwork inside the 66/108 safe zone.
    body = svg(w, h, mark(w, h, w * 0.6));
  } else if (f.endsWith('ic_launcher_round.png')) {
    body = svg(w, h, `<circle cx="${w / 2}" cy="${h / 2}" r="${w / 2}" fill="${BG}"/>${mark(w, h, w * 0.78)}`);
  } else if (f.endsWith('ic_launcher.png')) {
    body = svg(w, h, `<rect width="${w}" height="${h}" rx="${w * 0.22}" fill="${BG}"/>${mark(w, h, w * 0.78)}`);
  } else {
    body = svg(w, h, `<rect width="${w}" height="${h}" fill="${BG}"/>${mark(w, h, Math.min(w, h) * 0.28)}`);
  }
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:transparent">${body}</body></html>`);
  await page.screenshot({ path: f, omitBackground: true });
}
await browser.close();
console.log(`rendered ${files.length} files`);
