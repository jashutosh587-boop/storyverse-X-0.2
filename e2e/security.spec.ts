import type { Page } from '@playwright/test';
import { ANON_KEY } from './mock-supabase/jwt';
import {
  accountMenu,
  APP_ORIGIN,
  configureMock,
  expect,
  MOCK_ORIGIN,
  newVisitor,
  OUTAGE_DETAIL,
  register,
  saveEntry,
  signIn,
  test,
  titleHref,
} from './support/test';

const alertWith = (page: Page, text: string | RegExp) => page.getByRole('alert').filter({ hasText: text });
const scriptRan = (page: Page) => page.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned);

test.describe('sessions and credentials', () => {
  test('the sign-in cookies are hidden from page scripts, locked to this site and marked secure', async ({ page, context }) => {
    await register(page);
    await page.goto('/');
    const cookies = (await context.cookies()).filter((cookie) => cookie.name.startsWith('sb-'));
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie, cookie.name).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', secure: true });
    }
    expect(await page.evaluate(() => document.cookie)).toBe('');
  });

  test('the browser only ever talks to the site, and no key or database address is in anything it receives', async ({ page, request }) => {
    const requested = new Set<string>();
    page.on('request', (r) => requested.add(r.url()));
    const html: string[] = [];
    const visit = async (path: string) => {
      await page.goto(path);
      html.push(await page.content()); // the rendered page, including the data the server embedded in it
    };

    for (const path of ['/', '/anime', '/search?q=bebop', await titleHref(page, 'Cowboy Bebop'), '/about', '/login', '/signup', '/forgot-password']) await visit(path);
    const me = await register(page);
    for (const path of ['/', '/library', '/settings', '/reset-password', `/u/${me.username}`]) await visit(path);

    expect([...new Set([...requested].map((url) => new URL(url).origin))]).toEqual([APP_ORIGIN]);

    const scripts = [...requested].filter((url) => /\/_next\/static\/.+\.js(\?|$)/.test(url));
    expect(scripts.length).toBeGreaterThan(3);
    const shipped = [...html, ...(await Promise.all(scripts.map(async (url) => (await request.get(url)).text())))].join('\n');
    for (const secret of [ANON_KEY, MOCK_ORIGIN, '127.0.0.1:54321']) {
      expect(shipped.includes(secret), `"${secret.slice(0, 24)}…" is not in any page or script`).toBe(false);
    }
  });
});

test.describe('hostile input', () => {
  test('is shown as plain text everywhere, and nothing runs', async ({ page, browser, problems }) => {
    const payload = {
      name: '<img src=x onerror="window.__pwned=1">',
      bio: '<script>window.__pwned=2</script><svg onload="window.__pwned=3"></svg>',
      notes: '"><img src=x onerror=window.__pwned=4>',
      query: '<script>window.__pwned=5</script>',
    };
    const dialogs: string[] = [];
    const watch = (target: Page) =>
      target.on('dialog', (dialog) => {
        dialogs.push(dialog.message());
        void dialog.dismiss();
      });
    watch(page);

    const me = await register(page);
    await page.goto('/settings');
    await page.getByLabel('Display name').fill(payload.name);
    await page.getByLabel('Bio', { exact: true }).fill(payload.bio);
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
    await page.goto(await titleHref(page, 'Dune'));
    await saveEntry(page, { status: 'planned', notes: payload.notes });

    const stranger = await newVisitor(browser, problems);
    try {
      watch(stranger.page);
      await stranger.page.goto(`/u/${me.username}`);
      await expect(stranger.page.getByRole('heading', { level: 1 })).toHaveText(payload.name);
      await expect(stranger.page.getByRole('main')).toContainText(payload.bio);
      expect(await scriptRan(stranger.page)).toBeUndefined();
      await expect(stranger.page.locator('[onerror], [onload], img[src="x"]')).toHaveCount(0);
    } finally {
      await stranger.context.close();
    }

    await page.goto('/library'); // the owner's own notes, where they are shown back
    await expect(page.getByRole('main')).toContainText(payload.notes);
    await expect(page.locator('[onerror], [onload]')).toHaveCount(0);
    expect(await scriptRan(page)).toBeUndefined();

    await page.goto(`/search?q=${encodeURIComponent(payload.query)}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Results for “${payload.query}”`);
    await expect(page.getByRole('combobox', { name: 'Search titles' })).toHaveValue(payload.query);
    expect(await scriptRan(page)).toBeUndefined();

    for (const path of [
      `/anime?genre=${encodeURIComponent('"><script>window.__pwned=6</script>')}`,
      `/login?next=${encodeURIComponent('"><script>window.__pwned=7</script>')}`,
      `/title/${encodeURIComponent('<img src=x onerror=window.__pwned=8>')}`,
      `/u/${encodeURIComponent('<img src=x onerror=window.__pwned=9>')}`,
    ]) {
      await page.goto(path);
      expect(await scriptRan(page), path).toBeUndefined();
      await expect(page.locator('[onerror], [onload]'), path).toHaveCount(0);
    }
    expect(dialogs).toEqual([]);
    problems.length = 0; // the two 404 pages above are logged by Chromium as resource errors
  });

  test('every inline script carries the request’s nonce, and the page has no inline event handlers', async ({ request }) => {
    const response = await request.get('/anime');
    const nonce = /'nonce-([^']+)'/.exec(response.headers()['content-security-policy'] ?? '')?.[1];
    expect(nonce).toBeTruthy();
    const body = await response.text();
    const inline = [...body.matchAll(/<script\b([^>]*)>/g)].map((match) => match[1] ?? '').filter((attributes) => !/\bsrc=/.test(attributes));
    expect(inline.length).toBeGreaterThan(0);
    for (const attributes of inline) expect(attributes).toContain(`nonce="${nonce}"`);
    expect(body).not.toMatch(/\son(click|load|error|mouseover|submit)=/i);
  });

  test('odd addresses and oversized input never produce a server error', async ({ request }) => {
    const paths = [
      '/title/%00',
      `/title/${'a'.repeat(3000)}`,
      '/u/%ff',
      '/u/..%2f..%2fetc%2fpasswd',
      '/anime?page=1e9',
      '/anime?page=-1',
      '/anime?page=0',
      `/anime?genre=${'x'.repeat(5000)}`,
      '/anime?min=NaN&from=abc&to=999999999999',
      `/search?q=${'q'.repeat(10_000)}`,
      '/search?sort=DROP%20TABLE%20titles',
      `/anime?${Array.from({ length: 200 }, (_, i) => `genre=g${i}`).join('&')}`,
      '/library?status=nonsense&page=abc',
      '/%',
    ];
    for (const path of paths) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path.slice(0, 80)).toBeLessThan(500);
    }
    expect((await request.get('/')).status()).toBe(200); // and the site is still up
  });

  test('the confirmation callback only ever sends the visitor to a path on this site', async ({ request }) => {
    for (const path of [
      '/auth/callback',
      '/auth/callback?code=bogus',
      '/auth/callback?code=bogus&next=//evil.example',
      '/auth/callback?code=bogus&next=https://evil.example',
    ]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(303);
      expect(response.headers()['location'], path).toBe('/login?error=callback');
      expect(response.headers()['cache-control'], path).toBe('private, no-store');
    }
  });

  test('the password-reset callback sends every visitor who cannot use it back to the request form, and nowhere else', async ({ request }) => {
    for (const path of [
      '/auth/recovery',
      '/auth/recovery?code=bogus',
      '/auth/recovery?code=bogus&next=//evil.example',
      '/auth/recovery?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    ]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(303);
      expect(response.headers()['location'], path).toBe('/forgot-password?error=link');
      expect(response.headers()['cache-control'], path).toBe('private, no-store');
    }
  });

  test('routes only answer the methods they are built for', async ({ request }) => {
    expect((await request.post('/auth/callback')).status()).toBe(405);
    expect((await request.post('/auth/recovery')).status()).toBe(405);
    expect((await request.delete('/settings/export')).status()).toBe(405);
    expect((await request.put('/api/suggest?q=bebop')).status()).toBe(405);
    expect((await request.post('/api/health')).status()).toBe(405);
  });
});

test.describe('what is sent with every response', () => {
  test('the security headers come with pages, errors, data routes and files', async ({ request }) => {
    const expected = {
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'cross-origin-opener-policy': 'same-origin',
      'permissions-policy': expect.stringContaining('camera=()'),
      'strict-transport-security': expect.stringContaining('max-age='),
    };
    for (const path of ['/', '/anime', '/login', '/forgot-password', '/definitely-missing', '/api/suggest?q=bebop', '/api/health', '/robots.txt', '/sitemap.xml', '/settings/export']) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.headers(), path).toMatchObject(expected);
    }
  });

  test('pages that can differ per visitor are never shared by caches, while public data may be', async ({ request }) => {
    for (const path of ['/', '/anime', '/search?q=bebop', '/about', '/login', '/forgot-password']) {
      expect((await request.get(path)).headers()['cache-control'], path).toMatch(/no-store|private/);
    }
    expect((await request.get('/api/suggest?q=bebop')).headers()['cache-control']).toMatch(/public/);

    const page = await (await request.get('/')).text();
    const asset = /\/_next\/static\/[^"']+\.js/.exec(page)?.[0];
    expect(asset).toBeTruthy();
    expect((await request.get(asset!)).headers()['cache-control']).toMatch(/immutable/);
  });
});

test.describe('search engines', () => {
  test('are told what to index: the catalog yes, accounts and results no', async ({ request, page }) => {
    const robots = await (await request.get('/robots.txt')).text();
    for (const path of ['/api/', '/auth/', '/settings', '/library', '/login', '/signup', '/forgot-password', '/reset-password']) {
      expect(robots).toContain(`Disallow: ${path}`);
    }
    expect(robots).toContain(`Sitemap: ${APP_ORIGIN}/sitemap.xml`);

    const sitemap = await (await request.get('/sitemap.xml')).text();
    for (const path of ['/', '/anime', '/movies', '/tv', '/books', '/novels', '/manga', '/about']) {
      expect(sitemap).toContain(`<loc>${APP_ORIGIN}${path === '/' ? '/' : path}</loc>`);
    }
    for (const private_ of ['/settings', '/library', '/login', '/signup', '/forgot-password', '/reset-password', '/u/']) expect(sitemap).not.toContain(private_);

    for (const path of ['/login', '/signup', '/forgot-password', '/search?q=bebop']) {
      await page.goto(path);
      await expect(page.locator('meta[name="robots"]'), path).toHaveAttribute('content', /noindex/);
    }
    const title = await titleHref(page, 'Cowboy Bebop');
    await page.goto(title);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${APP_ORIGIN}${title}`);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  });
});

test.describe('when something behind the site fails', () => {
  test('a database outage gives visitors a plain apology and no internals, and the site recovers', async ({ page, request, problems }) => {
    await register(page);
    const healthy = await request.get('/api/health');
    expect(healthy.status()).toBe(200);
    expect(await healthy.json()).toEqual({ status: 'ok' });
    expect(healthy.headers()['cache-control']).toBe('no-store');

    await configureMock(request, { outage: 'database' });
    try {
      const health = await request.get('/api/health');
      expect(health.status(), 'monitors are told the site cannot reach its database').toBe(503);
      const healthBody = await health.text();
      expect(JSON.parse(healthBody)).toEqual({ status: 'unavailable' });
      for (const leak of ['postgres', 'db.internal', 'password authentication', 'PGRST']) {
        expect(healthBody.includes(leak), `the health answer does not repeat "${leak}"`).toBe(false);
      }

      const response = await page.goto('/anime');
      expect(response?.status()).toBe(500);
      await expect(page.getByRole('heading', { name: 'Something went wrong on our side' })).toBeVisible();
      const html = await page.content();
      for (const leak of ['postgres', 'db.internal', 'password authentication', 'PGRST', 'ApiError']) {
        expect(html.includes(leak), `the page does not repeat "${leak}"`).toBe(false);
      }

      const suggestions = await request.get('/api/suggest?q=bebop');
      expect(suggestions.status()).toBe(502);
      expect(await suggestions.text()).toBe('[]');

      await configureMock(request, { outage: 'none' });
      expect((await request.get('/api/health')).status()).toBe(200);
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Anime');
    } finally {
      await configureMock(request, { outage: 'none' });
      problems.length = 0; // the failed page load is logged by Chromium as a resource error
    }
  });

  test('an outage of the sign-in service says so plainly and does not sign anyone out', async ({ page, request }) => {
    const me = await register(page);
    await configureMock(request, { outage: 'auth' });
    try {
      await page.goto('/anime');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Anime'); // browsing carries on
      await expect(page.locator('header').getByRole('link', { name: 'Sign in' })).toBeVisible(); // who you are cannot be confirmed right now

      await signIn(page, me);
      await expect(alertWith(page, 'Sign-in is unavailable right now. Try again in a moment.')).toBeVisible();
      const html = await page.content();
      for (const leak of ['postgres', 'db.internal', 'password authentication']) expect(html.includes(leak)).toBe(false);
    } finally {
      await configureMock(request, { outage: 'none' });
    }
    await page.goto('/');
    await expect(accountMenu(page, me.username)).toBeVisible(); // the session survived the outage
  });
});

// Used by the leak checks above: make sure the stand-in's message is the one being looked for.
test('the outage message used by these tests contains what the leak checks look for', () => {
  for (const part of ['postgres', 'db.internal', 'password authentication']) expect(OUTAGE_DETAIL).toContain(part);
});
