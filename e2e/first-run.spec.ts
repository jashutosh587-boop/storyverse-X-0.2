import { accountMenu, expect, register, signOut, test } from './support/test';

/**
 * The site as its owner first sees it: the database is set up and the sign-in service is connected, but no title has been
 * imported yet. This project runs against its own stand-in with an empty catalog (see playwright.config.ts). A new site must
 * say what is missing and what to do about it, show no invented content, and keep every page that does not depend on titles working.
 */
const CATEGORY_EMPTY_HEADINGS: Array<[slug: string, heading: string]> = [
  ['anime', 'No anime in the catalog yet'],
  ['movies', 'No movies in the catalog yet'],
  ['tv', 'No TV in the catalog yet'],
  ['books', 'No books in the catalog yet'],
  ['novels', 'No novels in the catalog yet'],
  ['manga', 'No manga in the catalog yet'],
];

test.describe('a new site with nothing imported', () => {
  test('the home page says the catalog is empty and tells the owner how to fill it, with no invented content', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Find your next story');
    await expect(page.getByRole('heading', { name: 'The catalog is empty' })).toBeVisible();
    await expect(page.getByText('Nothing here is placeholder content.')).toBeVisible();
    await expect(page.getByText('npm run ingest -- jikan anime --pages 2')).toBeVisible();

    const categories = page.getByRole('list', { name: 'Browse by category' }).getByRole('listitem');
    await expect(categories).toHaveCount(6);
    for (const label of ['Anime', 'Movies', 'TV', 'Books', 'Novels', 'Manga']) {
      await expect(categories.filter({ hasText: label }), `${label} shows a count of zero`).toHaveText(new RegExp(`^${label}\\s*0$`));
    }
    await expect(page.locator('main img'), 'no artwork is invented').toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Popular right now|Highest rated/ })).toHaveCount(0);
  });

  test('every category says it has nothing, in plain words, and offers no filters', async ({ page }) => {
    for (const [slug, heading] of CATEGORY_EMPTY_HEADINGS) {
      await page.goto(`/${slug}`);
      await expect(page.getByRole('heading', { level: 1 }), slug).toBeVisible();
      // exact: a plain name matches ignoring case, and "No tv" is not how the site writes "TV".
      await expect(page.getByRole('heading', { name: heading, exact: true }), slug).toBeVisible();
      await expect(page.getByText('Filter and sort'), slug).toHaveCount(0);
      await expect(page.getByText('docs/DEPLOYMENT.md'), `${slug} points the owner to the setup guide`).toBeVisible();
    }
  });

  test('search says the catalog is empty, not that nothing matched, and its category links agree', async ({ page }) => {
    for (const path of ['/search', '/search?q=bebop']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'The catalog is empty' }), path).toBeVisible();
      await expect(page.getByText('Filter and sort'), path).toHaveCount(0);
      await expect(page.getByText('No titles match.'), path).toHaveCount(0);
      await expect(page.getByText(/Check the spelling/), `${path} does not blame the spelling`).toHaveCount(0);
    }
    for (const [slug, heading] of CATEGORY_EMPTY_HEADINGS) {
      await page.goto(`/search?type=${slug}`);
      await expect(page.getByRole('heading', { name: heading, exact: true }), slug).toBeVisible();
    }
  });

  test('the title-free parts of the site still work: suggestions, health, sitemap, sources and missing titles', async ({ page, request, problems }) => {
    expect(await (await request.get('/api/suggest?q=bebop')).json()).toEqual([]);
    const health = await request.get('/api/health');
    expect(health.status()).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });

    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).toContain('/anime</loc>');
    expect(sitemap).not.toContain('/title/');

    await page.goto('/about');
    await expect(page.getByText('No data has been imported yet, so there are no sources to list.')).toBeVisible();

    const missing = await page.goto('/title/does-not-exist');
    expect(missing?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    problems.length = 0; // Chromium logs a navigation to a 404 as a resource error
  });

  test('the first member can sign up, see an empty library, change settings and leave', async ({ page }) => {
    const me = await register(page);
    await page.goto('/library');
    await expect(page.getByRole('heading', { name: 'Your library is empty' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse the catalog' })).toBeVisible();

    await page.goto(`/u/${me.username}`);
    await expect(page.getByRole('heading', { name: 'Your library is empty' })).toBeVisible();

    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
    await expect(page.getByText(`Signed in as ${me.email}`)).toBeVisible();

    await page.goto('/');
    await signOut(page, me.username);
    await expect(accountMenu(page, me.username)).toHaveCount(0);
  });
});
