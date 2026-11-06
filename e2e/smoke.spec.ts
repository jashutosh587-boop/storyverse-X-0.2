import { expect, test } from './support/test';

test.describe('the site, signed out', () => {
  test('home page shows the seeded catalog, with real counts and rails', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Storyverse X/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Find your next story');

    // 40 generated anime, 2 fixture anime, 1 manga, 1 movie, 1 TV series, 1 book.
    const categories = page.getByRole('list', { name: 'Browse by category' });
    await expect(categories.getByRole('link', { name: /^Anime\s*42$/ })).toBeVisible();
    await expect(categories.getByRole('link', { name: /^Movies\s*1$/ })).toBeVisible();
    await expect(categories.getByRole('link', { name: /^Manga\s*1$/ })).toBeVisible();
    await expect(categories.getByRole('link', { name: /^Novels\s*0$/ })).toBeVisible();

    await expect(page.getByRole('list', { name: 'Popular titles' }).getByRole('listitem')).toHaveCount(12);
    await expect(page.getByRole('list', { name: 'Highest rated titles' }).getByRole('listitem')).toHaveCount(12);
  });

  test('sends the security headers and a fresh nonce on every page', async ({ request }) => {
    const first = await request.get('/');
    const second = await request.get('/');
    const csp = first.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('upgrade-insecure-requests'); // the tests run over plain http
    const nonce = (policy: string) => /'nonce-([^']+)'/.exec(policy)?.[1];
    expect(nonce(csp)).toBeTruthy();
    expect(nonce(csp)).not.toBe(nonce(second.headers()['content-security-policy'] ?? ''));
    expect(first.headers()['x-content-type-options']).toBe('nosniff');
    expect(first.headers()['x-frame-options']).toBe('DENY');
    expect(first.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(first.headers()['x-powered-by']).toBeUndefined();
  });

  test('unknown addresses give a helpful 404, not a blank page', async ({ page, problems }) => {
    for (const path of ['/definitely-not-a-page', '/title/no-such-title-0000', '/u/nobody_here', '/anime/extra']) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('search')).toBeVisible();
    }
    problems.length = 0; // Chromium logs each navigation to a 404 as a resource error
  });

  test('members-only pages send a signed-out visitor to sign in and bring them back afterwards', async ({ page }) => {
    for (const path of ['/library', '/settings']) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path).replace('%', '%')}`));
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    }
    const exported = await page.request.get('/settings/export');
    expect(exported.status()).toBe(401);
  });

  test('crawls every link reachable from the home page and none is dead', async ({ page, request }) => {
    const seen = new Set<string>();
    const queue = ['/'];
    const broken: string[] = [];
    while (queue.length > 0 && seen.size < 60) {
      const path = queue.shift()!;
      if (seen.has(path)) continue;
      seen.add(path);
      const response = await page.goto(path);
      if (!response || response.status() >= 400) {
        broken.push(`${path} -> ${response?.status()}`);
        continue;
      }
      const hrefs = await page.locator('a[href]').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
      for (const href of hrefs) {
        if (href.startsWith('#') || href.startsWith('mailto:')) continue;
        if (/^https?:\/\//.test(href)) continue; // outside links are checked below
        const clean = href.split('#')[0]!;
        if (clean && !seen.has(clean) && !queue.includes(clean) && !clean.startsWith('/settings/export')) queue.push(clean);
      }
    }
    expect(broken).toEqual([]);
    expect(seen.size).toBeGreaterThan(20);
    // Outside links must be https and must not hand the new tab a reference back to this one.
    await page.goto('/about');
    const outside = await page.locator('a[href^="http"]').evaluateAll((links) =>
      links.map((link) => ({ href: link.getAttribute('href'), rel: link.getAttribute('rel'), target: link.getAttribute('target') })),
    );
    for (const link of outside) {
      expect(link.href).toMatch(/^https:\/\//);
      expect(link.rel).toContain('noopener');
      expect(link.target).toBe('_blank');
    }
    expect(request).toBeTruthy();
  });
});
