import { expect, test, type Page } from '@playwright/test';
import { SCHOLARS_MATE } from '../fixtures/games';

async function clickSquare(page: Page, board: string, square: string) {
  await page.locator(`[data-testid="board-${board}"] [data-square="${square}"]`).click();
}

test('import → analyze → review → why not → retry → train → reopen', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(e.message));

  // Settings: tell KnightScope which player is "me" and use the fast preset.
  await page.goto('./#/settings');
  await page.getByLabel('Other names in PGN files').fill('Bob');
  await page.getByRole('button', { name: 'Save usernames' }).click();
  await page.getByLabel('Default preset').selectOption('fast');

  // 1. Import a PGN by pasting it.
  await page.goto('./#/import');
  await page.getByRole('radio', { name: 'Paste PGN' }).click();
  await page.getByTestId('pgn-paste').fill(SCHOLARS_MATE);
  await page.getByRole('button', { name: 'Import PGN' }).click();
  await expect(page.getByTestId('import-outcome')).toContainText('1 new game added');
  // Duplicate import is rejected.
  await page.getByRole('button', { name: 'Import PGN' }).click();
  await expect(page.getByTestId('import-outcome')).toContainText('0 new games added, 1 already in your library');

  // 2. Analyze with the real engine.
  await page.getByRole('row', { name: /Alice.*Bob/ }).getByRole('button', { name: 'Review' }).click();
  await expect(page.locator('#queue').locator('xpath=ancestor::section')).toContainText(/running|done/, { timeout: 30_000 });
  const openReview = page.getByRole('row', { name: /Alice.*Bob/ }).getByRole('link', { name: 'Open review' });
  await expect(openReview).toBeVisible({ timeout: 240_000 });
  await openReview.click();

  // 3. Navigate the game with the keyboard.
  const board = page.getByTestId('board-review');
  const startFen = await board.getAttribute('data-fen');
  await page.keyboard.press('ArrowRight');
  await expect(board).not.toHaveAttribute('data-fen', startFen!);
  await page.keyboard.press('ArrowLeft');
  await expect(board).toHaveAttribute('data-fen', startFen!);

  // 4. Open the blunder from the critical-moment timeline.
  await page.getByTestId('critical-moments').getByRole('button', { name: /Blunder at move 3/ }).click();
  await expect(page.getByTestId('current-move')).toContainText('3… Nf6');
  await expect(page.getByTestId('current-move')).toContainText('Blunder');

  // 5. Compare both continuations.
  await page.getByRole('button', { name: 'Why not my move?' }).click();
  const dialog = page.getByRole('dialog', { name: /Why not my move/ });
  await expect(dialog.getByTestId('why-your')).toContainText('Your move: 3… Nf6');
  await expect(dialog.getByTestId('why-your')).toContainText(/checkmate|mate in 1/i);
  const betterText = await dialog.getByTestId('why-best').locator('h3').innerText();
  const bestSan = betterText.replace(/^Better: 3… /, '').trim();
  expect(bestSan.length).toBeGreaterThan(1);
  await dialog.getByTestId('why-your').getByRole('button', { name: 'Next move' }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();

  // 6. Retry the position: g6 blocks the queen's attack on f7 and is a sound defence.
  await page.getByRole('button', { name: 'Retry position' }).click();
  await clickSquare(page, 'retry', 'g7');
  await clickSquare(page, 'retry', 'g6');
  await expect(page.getByTestId('retry-verdict')).toBeVisible({ timeout: 60_000 });
  const verdict = await page.getByTestId('retry-verdict').innerText();
  expect(verdict).toMatch(/Correct|Accepted|Not quite/);

  // 7. Save the mistake as an exercise.
  await page.getByRole('button', { name: 'Close retry' }).click();
  await page.getByRole('button', { name: 'Add to training' }).click();
  await expect(page.getByText('Saved as a training exercise.')).toBeVisible();

  // 8. Complete the exercise with the engine's move.
  await page.goto('./#/training');
  await page.getByRole('radio', { name: 'All' }).click();
  await page.getByRole('button', { name: 'Practice', exact: true }).first().click();
  await expect(page.getByTestId('exercise-goal')).toContainText('Black to move');
  const bestUci = await page.evaluate(async () => {
    const req = indexedDB.open('knightscope');
    const dbx: IDBDatabase = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
    const ex = await new Promise<{ solution: string[] }[]>((res) => { const r = dbx.transaction('exercises').objectStore('exercises').getAll(); r.onsuccess = () => res(r.result); });
    return ex[0].solution[0];
  });
  await clickSquare(page, 'training', bestUci.slice(0, 2));
  await clickSquare(page, 'training', bestUci.slice(2, 4));
  await page.getByRole('button', { name: 'Submit move' }).click();
  await expect(page.getByTestId('exercise-verdict')).toContainText(/Correct|Accepted|solved/i, { timeout: 60_000 });
  await expect(page.getByRole('cell', { name: 'Solved' })).toBeVisible();

  // 9. Reopen the saved review after a full reload (data persisted locally).
  await page.goto('./#/games');
  await page.reload();
  await page.getByRole('row', { name: /Alice.*Bob/ }).getByRole('link', { name: 'Open review' }).click();
  await expect(page.getByText('Move quality')).toBeVisible();
  await expect(page.getByTestId('critical-moments')).toContainText('Nf6');

  // Mistake memory shows the real mistake.
  await page.goto('./#/mistakes');
  await expect(page.getByRole('heading', { name: 'King-safety errors (allowed mate)' })).toBeVisible();

  expect(consoleErrors.filter((e) => !/favicon|DevTools/.test(e))).toEqual([]);
});
