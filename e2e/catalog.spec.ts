import { expect, test, titleHref } from './support/test';

test.describe('browsing', () => {
  test('a category pages through its titles', async ({ page }) => {
    await page.goto('/anime');
    const grid = page.getByRole('list', { name: 'Anime titles' });
    await expect(grid.getByRole('listitem')).toHaveCount(24);
    await expect(page.getByText('Showing 1 to 24 of 42 titles')).toBeVisible();
    await expect(page.getByText('Page 1 of 2')).toBeVisible();

    await page.getByRole('link', { name: 'Next' }).click();
    await expect(page).toHaveURL(/\/anime\?page=2$/);
    await expect(grid.getByRole('listitem')).toHaveCount(18);
    await expect(page.getByText('Showing 25 to 42 of 42 titles')).toBeVisible();

    await page.getByRole('link', { name: 'Previous' }).click();
    await expect(page).toHaveURL(/\/anime$/);
  });

  test('a page number past the end lands on the last page instead of an empty one', async ({ page }) => {
    await page.goto('/anime?page=99');
    await expect(page).toHaveURL(/\/anime\?page=2$/);
    await expect(page.getByRole('list', { name: 'Anime titles' }).getByRole('listitem')).toHaveCount(18);
  });

  test('genre filters narrow the list to exactly the count the filter promised, and can be removed', async ({ page }) => {
    await page.goto('/anime');
    await page.getByText('Filter and sort').click();
    const chip = page.locator('label.chip', { hasText: /^Action\s*\d+$/ });
    const promised = Number((await chip.textContent())!.replace(/\D/g, ''));
    expect(promised).toBeGreaterThan(1);
    await chip.click();
    await page.getByRole('button', { name: 'Show results' }).click();

    await expect(page).toHaveURL(/genre=Action/);
    await expect(page.getByText(`of ${promised} title`)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Active filters' })).toContainText('Action');

    await page.getByRole('link', { name: 'Remove filter: Action' }).click();
    await expect(page).not.toHaveURL(/genre=/);
    await expect(page.getByText('of 42 titles')).toBeVisible();
  });

  test('sorting by title puts the alphabetically first title first', async ({ page }) => {
    await page.goto('/anime?sort=title');
    const first = page.getByRole('list', { name: 'Anime titles' }).getByRole('listitem').first();
    await expect(first).toContainText('Cowboy Bebop');
    await expect(page.getByLabel('Sort by').or(page.locator('#f-sort'))).toBeHidden(); // the form is folded away until asked for
  });

  test('year and score filters are applied together', async ({ page }) => {
    await page.goto('/anime?from=2000&to=2010&min=8');
    const count = await page.getByRole('list', { name: 'Anime titles' }).getByRole('listitem').count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(42);
    for (const badge of await page.locator('ul[aria-label="Anime titles"] li span.sr-only').allTextContents()) {
      const score = Number(/score ([\d.]+) out of 10/.exec(badge)![1]);
      expect(score).toBeGreaterThanOrEqual(8);
    }
    for (const meta of await page.locator('ul[aria-label="Anime titles"] li p.text-muted').allTextContents()) {
      const year = Number(/(\d{4})$/.exec(meta)![1]);
      expect(year).toBeGreaterThanOrEqual(2000);
      expect(year).toBeLessThanOrEqual(2010);
    }
  });

  test('an empty category says so and points to what to do', async ({ page }) => {
    await page.goto('/novels');
    await expect(page.getByRole('heading', { name: 'No novels in the catalog yet' })).toBeVisible();
    await expect(page.getByText('Nothing here is placeholder')).toHaveCount(0);
  });

  test('artwork that cannot be loaded is replaced by the same placeholder as a title with no artwork, never a broken image', async ({
    page,
    context,
    problems,
  }) => {
    // The provider's host is down: every artwork request fails. (Later routes win, so this replaces the generated stand-in.)
    await context.route('**/_next/image**', (route) => route.fulfill({ status: 502, contentType: 'text/plain', body: 'bad gateway' }));

    const grid = page.getByRole('list', { name: 'Anime titles' });
    await page.goto('/anime');
    await expect(grid.getByRole('listitem')).toHaveCount(24);
    await expect(grid.locator('img'), 'no image is left in the grid').toHaveCount(0);
    const first = grid.getByRole('listitem').first();
    await expect(first.locator('[aria-hidden="true"]', { hasText: 'Anime' }), 'the first title shows its placeholder').toBeVisible();

    // The same on a title page, where the cover is the large one at the top.
    await page.goto(await titleHref(page, 'Cowboy Bebop'));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cowboy Bebop');
    await expect(page.locator('main img'), 'no image is left on the title page').toHaveCount(0);
    await expect(page.locator('main [aria-hidden="true"]', { hasText: 'CB' }).first()).toBeVisible();
    problems.length = 0; // Chromium logs each refused image as a resource error, and refusing them is what this test does
  });
});

test.describe('search', () => {
  test('finds a title, forgives a typo, and says plainly when nothing matches', async ({ page }) => {
    await page.goto('/search?q=cowboy+bebop');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Results for “cowboy bebop”');
    const results = page.getByRole('list', { name: 'Search results' });
    await expect(results.getByRole('link').first()).toContainText('Cowboy Bebop');

    await page.goto('/search?q=cowboy+bebpo');
    await expect(page.getByRole('list', { name: 'Search results' }).getByRole('link', { name: /Cowboy Bebop/ }).first()).toBeVisible();

    await page.goto('/search?q=zzzzqqqq');
    await expect(page.getByRole('heading', { name: 'Nothing found for “zzzzqqqq”' })).toBeVisible();
    await expect(page.getByText('Typos of a letter or two are forgiven')).toBeVisible();
  });

  test('says a category is empty instead of offering filters and counts for titles that do not exist', async ({ page }) => {
    for (const path of ['/search?type=novels', '/search?q=anything&type=novels']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'No novels in the catalog yet' }), path).toBeVisible();
      await expect(page.getByText('Filter and sort'), path).toHaveCount(0);
      await expect(page.getByText('No titles match.'), path).toHaveCount(0);
    }
    // A category that has titles still says what did not match.
    await page.goto('/search?q=zzzzqqqq&type=anime');
    await expect(page.getByRole('heading', { name: 'Nothing found for “zzzzqqqq”' })).toBeVisible();
  });

  test('can be narrowed by category, and filters keep the search text and category', async ({ page }) => {
    await page.goto('/search?q=bebop');
    await page.getByRole('navigation', { name: 'Narrow by category' }).getByRole('link', { name: 'Movies' }).click();
    await expect(page).toHaveURL(/q=bebop&type=movies/);
    await expect(page.getByRole('heading', { name: /Nothing found/ })).toBeVisible();

    await page.getByRole('navigation', { name: 'Narrow by category' }).getByRole('link', { name: 'Anime' }).click();
    await expect(page.getByRole('list', { name: 'Search results' }).getByRole('link', { name: /Cowboy Bebop/ }).first()).toBeVisible();

    await page.getByText('Filter and sort').click();
    await page.locator('#f-min').fill('5');
    await page.getByRole('button', { name: 'Show results' }).click();
    await expect(page).toHaveURL(/q=bebop/);
    await expect(page).toHaveURL(/type=anime/);
    await expect(page).toHaveURL(/min=5/);

    // With a filter active the panel opens by itself, so the way out is already on screen.
    await expect(page.locator('#f-min')).toHaveValue('5');
    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page).toHaveURL(/q=bebop/);
    await expect(page).toHaveURL(/type=anime/);
    await expect(page).not.toHaveURL(/min=/);
  });

  test('suggests titles while typing, works by keyboard, and still submits as a plain form', async ({ page }) => {
    await page.goto('/');
    const box = page.getByRole('combobox', { name: 'Search titles' });
    const suggestions = page.waitForResponse((r) => r.url().includes('/api/suggest?q=cowb') && r.status() === 200);
    await box.fill('cowb');
    await suggestions;
    const list = page.getByRole('listbox', { name: 'Suggested titles' });
    await expect(list.getByRole('option').first()).toContainText('Cowboy Bebop');

    await box.press('ArrowDown');
    await expect(box).toHaveAttribute('aria-activedescendant', /.+/);
    await box.press('Enter');
    await expect(page).toHaveURL(/\/title\/cowboy-bebop-[0-9a-f]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cowboy Bebop');

    // The same list works with a mouse.
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Search titles' }).fill('berserk');
    await page.getByRole('option', { name: /Berserk/ }).first().click();
    await expect(page).toHaveURL(/\/title\/berserk-[0-9a-f]+$/);

    await page.goto('/');
    await page.getByRole('combobox', { name: 'Search titles' }).fill('berserk');
    await page.getByRole('combobox', { name: 'Search titles' }).press('Enter'); // nothing highlighted: submit
    await expect(page).toHaveURL(/\/search\?q=berserk/);
  });

  test('the suggestion endpoint is bounded, cacheable, and safe with hostile input', async ({ request }) => {
    const short = await request.get('/api/suggest?q=a');
    expect(await short.json()).toEqual([]);

    const hit = await request.get('/api/suggest?q=bebop');
    expect(hit.status()).toBe(200);
    expect(hit.headers()['cache-control']).toContain('public');
    const rows = (await hit.json()) as Array<{ slug: string; title: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(8);

    for (const evil of ["'; drop table titles; --", '%00', '"', '\\', 'a'.repeat(5000), '<script>alert(1)</script>']) {
      const response = await request.get(`/api/suggest?q=${encodeURIComponent(evil)}`);
      expect([200, 414]).toContain(response.status());
    }
    const after = await request.get('/api/suggest?q=bebop');
    expect((await after.json()).length).toBe(rows.length); // the catalog is intact
  });
});

test.describe('title pages', () => {
  test('an anime shows the source score, no invented member score, linked genres, and its connections', async ({ page }) => {
    await page.goto(await titleHref(page, 'Cowboy Bebop'));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cowboy Bebop');
    await expect(page.getByText('カウボーイビバップ')).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Score on MyAnimeList' })).toBeVisible();
    await expect(page.getByText('8.75', { exact: true })).toBeVisible();
    await expect(page.getByText('From 1M ratings')).toBeVisible();
    // Member ratings are only ever shown when members gave them (the account tests rate this title).
    await expect(page.locator('section[aria-label="Scores"] .panel', { hasText: 'Storyverse members' })).toContainText(
      /Nobody has rated this yet|Average of \d+ ratings?/,
    );

    await page.getByRole('list', { name: 'Genres' }).getByRole('link', { name: 'Action' }).click();
    await expect(page).toHaveURL(/\/anime\?genre=Action$/);
    await page.goBack();

    const connected = page.getByRole('region', { name: 'Connected stories' });
    await expect(connected.getByRole('link', { name: /Tengoku no Tobira/ })).toBeVisible();
    // Not in the catalog yet: named, but not a link, and it says why.
    await expect(connected.getByText('A Spin-off')).toBeVisible();
    await expect(connected.getByRole('link', { name: /A Spin-off/ })).toHaveCount(0);
    await expect(connected.getByText(/A Spin-off.*not in the catalog yet/)).toBeVisible();

    const similar = page.getByRole('region', { name: 'Similar titles' });
    await expect(similar.getByRole('listitem').first()).toBeVisible();
    await expect(similar.getByText('Shares Action').first()).toBeVisible();

    const sources = page.getByRole('region', { name: 'Sources' });
    const link = sources.getByRole('link', { name: /MyAnimeList/ });
    await expect(link).toHaveAttribute('href', /^https:\/\/myanimelist\.net\/anime\/1/);
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(sources.getByText(/Metadata and scores from MyAnimeList/)).toBeVisible();
    await expect(page.getByText('This product uses the TMDB API')).toHaveCount(0);
  });

  test('a connected title is reachable from the thread', async ({ page }) => {
    await page.goto(await titleHref(page, 'Cowboy Bebop'));
    await page.getByRole('region', { name: 'Connected stories' }).getByRole('link', { name: /Tengoku no Tobira/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cowboy Bebop: Tengoku no Tobira');
    // This one has no synopsis and no score from its source, and the page says so instead of inventing either.
    await expect(page.getByText('The data sources do not provide a synopsis for this title.')).toBeVisible();
    await expect(page.getByText('The data source has no score for this title.')).toBeVisible();
    await expect(page.getByText('Nobody has rated this yet')).toBeVisible(); // and no account test rates this one
    // And the thread leads back.
    const back = page.getByRole('region', { name: 'Connected stories' }).getByRole('link', { name: /^Cowboy Bebop, anime, 1998$/ });
    await expect(back).toBeVisible();
    await back.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cowboy Bebop');
  });

  test('a film carries the TMDB credit, and a book credits Open Library', async ({ page }) => {
    await page.goto(await titleHref(page, 'Blade Runner'));
    await expect(page.getByRole('heading', { name: 'Score on TMDB' })).toBeVisible();
    await expect(page.getByText('This product uses the TMDB API but is not endorsed or certified by TMDB.')).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Credits' }).getByText('A Director')).toBeVisible();

    await page.goto(await titleHref(page, 'Dune'));
    await expect(page.getByRole('region', { name: 'Credits' }).getByText('Frank Herbert')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Sources' }).getByRole('link', { name: 'Open Library' })).toHaveAttribute('href', /^https:\/\/openlibrary\.org\//);
    await expect(page.getByText('This product uses the TMDB API')).toHaveCount(0);
  });

  test('a signed-out visitor is invited to sign up, and the invitation brings them back', async ({ page }) => {
    const here = await titleHref(page, 'Berserk');
    await page.goto(here);
    await expect(page.getByRole('heading', { name: /Keep track of this manga/ })).toBeVisible();
    await page.getByRole('link', { name: 'Sign in' }).last().click();
    await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(here).replace(/\//g, '%2F')}`));
  });
});

test.describe('the about page', () => {
  test('lists each data source with how many titles it supplied, and explains the scores', async ({ page }) => {
    await page.goto('/about');
    const sources = page.getByRole('region', { name: 'Where the data comes from' });
    await expect(sources.getByRole('listitem').filter({ hasText: 'MyAnimeList' })).toContainText('43 titles');
    await expect(sources.getByRole('listitem').filter({ hasText: 'TMDB' })).toContainText('2 titles');
    await expect(sources.getByRole('listitem').filter({ hasText: 'Open Library' })).toContainText('1 title');
    await expect(page.getByText('This product uses the TMDB API but is not endorsed or certified by TMDB.')).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'How scores work' })).toContainText('(v × R + m × C) ÷ (v + m)');
  });
});
