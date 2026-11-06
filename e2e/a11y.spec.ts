import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { accountMenu, expect, newIdentity, register, saveEntry, test, titleHref } from './support/test';

/**
 * Automated checks against WCAG 2.2 level A and AA. Automated checks find about a third of real accessibility
 * problems (missing names, contrast, structure, misused roles); they do not replace testing with a screen reader,
 * which has not been done (see docs/STATUS.md).
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function audit(page: Page, label: string) {
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const problems = results.violations.map((violation) => {
    const where = violation.nodes
      .slice(0, 3)
      .map((node) => `    ${node.target.join(' ')}\n      ${(node.failureSummary ?? '').split('\n').slice(1).join(' ')}`)
      .join('\n');
    return `${violation.id} (${violation.impact}): ${violation.help}\n${where}`;
  });
  expect(problems, `accessibility problems on ${label}`).toEqual([]);
  await expect(page.locator('h1'), `${label} has exactly one level-one heading`).toHaveCount(1);
}

test.describe('automated accessibility checks', () => {
  test('public pages', async ({ page }) => {
    const bebop = await titleHref(page, 'Cowboy Bebop');
    const film = await titleHref(page, 'Blade Runner');
    const manga = await titleHref(page, 'Berserk');
    const book = await titleHref(page, 'Dune');
    const pages: Array<[string, string]> = [
      ['home', '/'],
      ['category', '/anime'],
      ['category, second page', '/anime?page=2'],
      ['category, filtered', '/anime?genre=Action&sort=score&min=5'],
      ['empty category', '/novels'],
      ['search results', '/search?q=bebop'],
      ['search with nothing found', '/search?q=zzzzqqqq'],
      ['anime title', bebop],
      ['film title', film],
      ['manga title', manga],
      ['book title', book],
      ['about', '/about'],
      ['sign in', '/login'],
      ['sign up', '/signup'],
      ['reset your password', '/forgot-password'],
      ['reset link refused', '/forgot-password?error=link'],
    ];
    for (const [label, path] of pages) {
      await page.goto(path);
      await audit(page, label);
    }
  });

  test('public pages in a state other than their first one', async ({ page, problems }) => {
    await page.goto('/signup');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('#email-error')).toBeVisible();
    await audit(page, 'sign up with every field in error');

    await page.goto('/login');
    await page.getByLabel('Email address').fill('nobody@example.test');
    await page.getByLabel('Password').fill('not the password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'not right' })).toBeVisible();
    await audit(page, 'sign in with a refused password');

    await page.goto('/forgot-password');
    await page.getByLabel('Email address').fill('nobody@example.test');
    await page.getByRole('button', { name: 'Email me a reset link' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Check your email' })).toBeVisible();
    await audit(page, 'reset link requested');

    await page.goto('/anime');
    await page.getByText('Filter and sort').click();
    await audit(page, 'category with the filter panel open');

    await page.goto('/');
    await page.getByRole('combobox', { name: 'Search titles' }).fill('cowb');
    await expect(page.getByRole('listbox', { name: 'Suggested titles' })).toBeVisible();
    await audit(page, 'home with search suggestions open');

    await page.goto('/definitely-missing');
    await audit(page, 'page not found');
    problems.length = 0; // Chromium logs a navigation to a 404 as a resource error
  });

  test('member pages', async ({ page }) => {
    const me = await register(page, newIdentity('axe'));
    await page.goto(await titleHref(page, 'E2E Test Anime 020'));
    await audit(page, 'title with an empty library box');
    await saveEntry(page, { status: 'completed', rating: 6, notes: 'Checked for accessibility.' });
    await expect(page.getByRole('status').filter({ hasText: 'Saved to your library.' })).toBeVisible();
    await audit(page, 'title with a saved library entry');

    await page.goto(await titleHref(page, 'E2E Test Anime 021'));
    await saveEntry(page, { status: 'planned', private: true });

    for (const [label, path] of [
      ['library', '/library'],
      ['library with a status that has no entries', '/library?status=dropped'],
      ['settings', '/settings'],
      ['own profile', `/u/${me.username}`],
    ] as const) {
      await page.goto(path);
      await audit(page, label);
    }

    await page.goto('/settings');
    await page.getByLabel(/Type your username/).fill('wrong');
    await page.getByRole('button', { name: 'Delete my account permanently' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'to confirm' })).toBeVisible();
    await audit(page, 'settings with a refused deletion');

    await page.goto('/reset-password');
    await audit(page, 'choose a new password');
    await page.getByLabel('New password').fill('long enough one');
    await page.getByLabel('Confirm password').fill('something else entirely');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.locator('#confirm-error')).toBeVisible();
    await audit(page, 'choose a new password with a mismatch');

    await page.goto('/');
    await accountMenu(page, me.username).click();
    await expect(page.getByRole('link', { name: 'Your library' })).toBeVisible();
    await audit(page, 'home with the account menu open');
  });
});

test.describe('keyboard and small screens', () => {
  test('the first Tab offers to skip the header, and it works', async ({ page }) => {
    await page.goto('/anime');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport(); // it is out of sight until it has focus
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('main') !== null), 'the next stop is inside the main content').toBe(true);
  });

  test('every stop on the way through a page shows where the focus is', async ({ page }) => {
    for (const path of ['/', '/anime', '/login', '/forgot-password']) {
      await page.goto(path);
      const hidden: string[] = [];
      for (let stop = 1; stop <= 30; stop += 1) {
        await page.keyboard.press('Tab');
        const state = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          // A checkbox that is drawn as a chip shows its ring on the chip.
          const drawn = (el.closest('label.chip') as HTMLElement | null) ?? el;
          const style = getComputedStyle(drawn);
          const box = el.getBoundingClientRect();
          return {
            name: (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).replace(/\s+/g, ' ').trim().slice(0, 40),
            ring: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
            onScreen: box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight,
            tabindex: el.tabIndex,
          };
        });
        if (!state) break; // back to the browser's own controls
        if (!state.ring) hidden.push(`${state.name} (stop ${stop})`);
        if (!state.onScreen && state.name !== 'Skip to content') hidden.push(`${state.name} is focused but off screen (stop ${stop})`);
        expect(state.tabindex, `${state.name} must not jump the tab order`).toBeLessThanOrEqual(0);
      }
      expect(hidden, `on ${path}, stops without a visible focus ring`).toEqual([]);
    }
  });

  test('pages reflow to a 320 pixel screen without sideways scrolling', async ({ page, problems }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const bebop = await titleHref(page, 'Cowboy Bebop');
    const wide: string[] = [];
    const measure = async (path: string) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (extra > 0) wide.push(`${path} is ${extra}px too wide`);
    };
    for (const path of ['/', '/anime', '/anime?genre=Action&min=5', '/search?q=bebop', bebop, '/about', '/login', '/signup', '/forgot-password', '/definitely-missing']) {
      await measure(path);
    }
    const me = await register(page, newIdentity('narrow'));
    for (const path of [bebop, '/library', '/settings', '/reset-password', `/u/${me.username}`]) await measure(path);
    expect(wide).toEqual([]);
    problems.length = 0;
  });

  test('text can be enlarged to 200 percent without losing anything', async ({ page }) => {
    // Browser zoom at 200% on a 1280 pixel window is a 640 pixel layout viewport.
    await page.setViewportSize({ width: 640, height: 800 });
    const wide: string[] = [];
    for (const path of ['/', '/anime', '/search?q=bebop', await titleHref(page, 'Cowboy Bebop'), '/login', '/forgot-password']) {
      await page.goto(path);
      await page.evaluate(() => document.documentElement.style.setProperty('font-size', '200%', 'important')); // set through the DOM: the policy refuses injected <style>
      const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (extra > 0) wide.push(`${path} is ${extra}px too wide at 200% text`);
    }
    expect(wide).toEqual([]);
  });
});
