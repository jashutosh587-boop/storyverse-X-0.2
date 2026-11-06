import fs from 'node:fs';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { accountMenu, expect, newIdentity, register, test, titleHref } from './support/test';

/**
 * Checks that no page needs sideways scrolling at the project's screen size. With SCREENSHOTS=1 it also
 * saves a picture of each page to e2e/.artifacts/screens for a visual review. Those pictures show the
 * generated test catalog, not real data.
 */
const SHOTS = process.env.SCREENSHOTS === '1';
const OUT = path.join(__dirname, '.artifacts', 'screens');

async function check(page: Page, testInfo: TestInfo, name: string) {
  await page.waitForLoadState('networkidle');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${name} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
  if (SHOTS) {
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, `${testInfo.project.name}-${name}.png`), fullPage: true });
  }
}

test.describe('layout', () => {
  test('public pages fit the screen', async ({ page, problems }, testInfo) => {
    const bebop = await titleHref(page, 'Cowboy Bebop');
    const pages: Array<[string, string]> = [
      ['home', '/'],
      ['anime', '/anime'],
      ['anime-filtered', '/anime?genre=Action&sort=score&min=6'],
      ['search', '/search?q=bebop'],
      ['search-empty', '/search?q=zzzzqqqq'],
      ['title', bebop],
      ['title-book', '/title/' + (await titleHref(page, 'Dune')).split('/').pop()],
      ['about', '/about'],
      ['login', '/login'],
      ['signup', '/signup'],
      ['forgot-password', '/forgot-password'],
      ['not-found', '/no-such-page'],
    ];
    for (const [name, url] of pages) {
      const response = await page.goto(url);
      expect(response?.status(), url).toBe(name === 'not-found' ? 404 : 200);
      await check(page, testInfo, name);
      if (name === 'not-found') problems.length = 0; // Chromium logs a navigation to a 404 as a resource error
    }
  });

  test('member pages fit the screen', async ({ page }, testInfo) => {
    const identity = await register(page, newIdentity('layout'));
    const bebop = await titleHref(page, 'Cowboy Bebop');
    await page.goto(bebop);
    await page.getByLabel('Status').selectOption('in_progress');
    await page.getByLabel(/^Progress/).fill('12');
    await page.getByLabel('Your rating').selectOption('9');
    await page.getByLabel('Private notes').fill('Re-watching the Ganymede episode.');
    await page.getByRole('button', { name: 'Add to library' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved to your library.');
    await check(page, testInfo, 'title-in-library');

    const berserk = await titleHref(page, 'Berserk');
    await page.goto(berserk);
    await page.getByRole('button', { name: 'Add to library' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved to your library.');

    for (const [name, url] of [
      ['library', '/library'],
      ['library-filtered', '/library?status=in_progress'],
      ['profile', `/u/${identity.username}`],
      ['settings', '/settings'],
      ['reset-password', '/reset-password'],
    ] as const) {
      await page.goto(url);
      await check(page, testInfo, name);
    }

    // The header with the account menu open, as a viewport picture because the menu floats over the page.
    await page.goto('/');
    await accountMenu(page, identity.username).click();
    await expect(page.getByRole('link', { name: 'Your library' })).toBeVisible();
    if (SHOTS) await page.screenshot({ path: path.join(OUT, `${testInfo.project.name}-account-menu.png`) });
  });
});
