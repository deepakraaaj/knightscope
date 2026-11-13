import { expect, test } from '@playwright/test';
import { LEGAL_MATE } from '../fixtures/games';

test('phone review: board, controls, move strip and verdict fit on screen and tapping does not scroll', async ({ page }) => {
  await page.goto('./#/settings');
  await page.getByLabel('Default preset').selectOption('fast');
  await page.goto('./#/import');
  await page.getByRole('radio', { name: 'Paste PGN' }).click();
  await page.getByTestId('pgn-paste').fill(LEGAL_MATE);
  await page.getByRole('button', { name: 'Import PGN' }).click();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const open = page.getByRole('row', { name: /Legall/ }).getByRole('link', { name: 'Open review' });
  await expect(open).toBeVisible({ timeout: 200_000 });
  await open.click();

  const main = page.locator('main');
  const vh = page.viewportSize()!.height;
  const strip = page.getByRole('list', { name: 'Moves' }).first();
  const verdict = page.getByTestId('current-move');

  // Everything needed to step through the game is visible without scrolling.
  for (const el of [page.getByTestId('board-review'), page.getByRole('button', { name: 'Next move (Right arrow)' }), strip, verdict]) {
    const box = (await el.boundingBox())!;
    expect(box.y, 'element should not be scrolled off the top').toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, 'element should be inside the first screen').toBeLessThanOrEqual(vh);
  }

  // Tapping moves in the strip, the arrows and key-moment jumps never scrolls the page.
  // dispatchEvent taps like a finger: unlike click(), it does not scroll the element into view first.
  await strip.getByRole('listitem').nth(3).dispatchEvent('click');
  await page.getByRole('button', { name: 'Next move (Right arrow)' }).dispatchEvent('click');
  await page.getByRole('button', { name: 'Next key moment' }).dispatchEvent('click');
  await strip.getByRole('listitem').last().dispatchEvent('click');
  expect(await main.evaluate((m) => m.scrollTop)).toBe(0);
  await expect(verdict).toContainText('Nd5#');

  // The jump-to-key-moment button lands on the blunder and offers the comparison.
  await page.getByRole('button', { name: 'Start (Home)' }).dispatchEvent('click');
  // Key moments in this game: 4…g6 (mistake), 5.Nxe5 (brilliant), 5…Bxd1 (blunder).
  for (const san of ['g6', 'Nxe5', 'Bxd1']) {
    await page.getByRole('button', { name: 'Next key moment' }).dispatchEvent('click');
    await expect(verdict).toContainText(san);
  }
  await expect(verdict).toContainText('Blunder');
  // The action buttons are on screen above the bottom tab bar, with no scrolling.
  const tabBarTop = (await page.getByRole('navigation', { name: 'Primary' }).boundingBox())!.y;
  for (const name of ['Why not my move?', 'Retry position', 'Add to training']) {
    const b = (await page.getByRole('button', { name }).boundingBox())!;
    expect(b.y + b.height, `${name} should be visible above the tab bar`).toBeLessThanOrEqual(tabBarTop);
  }
  expect(await main.evaluate((m) => m.scrollTop)).toBe(0);

  // Swiping the board steps through moves.
  const board = (await page.getByTestId('board-review').boundingBox())!;
  const before = await page.getByTestId('board-review').getAttribute('data-fen');
  const y = board.y + board.height / 2;
  await page.evaluate(({ x1, x2, y }) => {
    const el = document.querySelector('[data-testid="board-review"]')!.parentElement!.parentElement!;
    const t = (x: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [t(x1)], changedTouches: [t(x1)], bubbles: true }));
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(x2)], bubbles: true }));
  }, { x1: board.x + board.width - 20, x2: board.x + 40, y });
  await expect(page.getByTestId('board-review')).not.toHaveAttribute('data-fen', before!);
});
