import { expect, test as base, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { OUTAGE_DETAIL } from '../mock-supabase/constants';
import { gradientPng } from './png';

export { OUTAGE_DETAIL };

export const APP_ORIGIN = 'http://127.0.0.1:3100';
/** The stand-in for Supabase. A browser must never talk to it: only the site's server does. */
export const MOCK_ORIGIN = 'http://127.0.0.1:54321';

/**
 * Applied to every browser context:
 *  - the browser may only talk to the site itself (it must never reach Supabase or any provider; the origin
 *    is compared in full, so the stand-in's port is refused too), and
 *  - provider artwork, which the site fetches through its image optimizer from hosts the test machine
 *    cannot reach, is answered with a generated stand-in so pages render as they would with artwork.
 */
export async function prepareContext(context: BrowserContext, problems: string[], appOrigin: string = APP_ORIGIN) {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== appOrigin) {
      problems.push(`the browser tried to reach another origin: ${url.href}`);
      return route.abort();
    }
    if (url.pathname === '/_next/image') {
      const source = url.searchParams.get('url') ?? '';
      const hue = [...source].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
      return route.fulfill({ status: 200, contentType: 'image/png', body: gradientPng(200, 300, hue) });
    }
    return route.continue();
  });
}

export function watchPage(page: Page, problems: string[]) {
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`uncaught error: ${error.message}`));
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? '';
    if (!/ERR_ABORTED/.test(reason)) problems.push(`failed request: ${request.url()} (${reason})`);
  });
}

/** A signed-out browser of its own, with the same guards as the default one. */
export async function newVisitor(browser: Browser, problems: string[] = []) {
  const context = await browser.newContext({ baseURL: APP_ORIGIN });
  await prepareContext(context, problems);
  const page = await context.newPage();
  watchPage(page, problems);
  return { context, page, problems };
}

export const test = base.extend<{ problems: string[] }>({
  // Anything unexpected the browser reports fails the test; a test that expects some clears the list first.
  // (Playwright names the second argument `use` by convention; it is called `provide` here so lint does not mistake it for a React hook.)
  problems: [
    async ({}, provide) => {
      const problems: string[] = [];
      await provide(problems);
      expect(problems, 'problems the browser reported').toEqual([]);
    },
    { auto: true },
  ],
  // The guard follows the project's own address, so the run against an empty site is held to the same rule.
  context: async ({ context, problems, baseURL }, provide) => {
    await prepareContext(context, problems, baseURL ? new URL(baseURL).origin : APP_ORIGIN);
    await provide(context);
  },
  page: async ({ page, problems }, provide) => {
    watchPage(page, problems);
    await provide(page);
  },
});

export { expect };

let counter = 0;
/** A username and email nobody else in this run has used. */
export function newIdentity(prefix = 'tester') {
  counter += 1;
  const tag = `${Date.now().toString(36).slice(-4)}${counter}`;
  return { username: `${prefix}_${tag}`, email: `${prefix}.${tag}@example.test`, password: 'correct horse battery' };
}

export async function register(page: Page, identity = newIdentity()) {
  await page.goto('/signup');
  await page.getByLabel('Email address').fill(identity.email);
  await page.getByLabel('Username').fill(identity.username);
  await page.getByLabel('Password').fill(identity.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(accountMenu(page, identity.username)).toBeVisible();
  return identity;
}

/** The signed-in visitor's menu button in the header. */
export const accountMenu = (page: Page, username: string) => page.locator('header summary', { hasText: `@${username}` });

/** Open the account menu and choose one of its entries. */
export async function chooseFromAccountMenu(page: Page, username: string, entry: 'Your profile' | 'Your library' | 'Settings' | 'Sign out') {
  await accountMenu(page, username).click();
  const item = entry === 'Sign out' ? page.getByRole('button', { name: entry }) : page.getByRole('link', { name: entry });
  await item.click();
}

export async function signIn(page: Page, identity: { email: string; password: string }, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  await page.getByLabel('Email address').fill(identity.email);
  await page.getByLabel('Password').fill(identity.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** The slug of a seeded title, found through the site's own search so the tests do not hard-code hashes. */
export async function titleHref(page: Page, name: string): Promise<string> {
  await page.goto(`/search?q=${encodeURIComponent(name)}`);
  const link = page.getByRole('list', { name: 'Search results' }).getByRole('link', { name: new RegExp(name) }).first();
  const href = await link.getAttribute('href');
  if (!href) throw new Error(`no title found for ${name}`);
  return href;
}

/** Sign out through the account menu and wait until the header offers sign-in again. */
export async function signOut(page: Page, username: string) {
  await chooseFromAccountMenu(page, username, 'Sign out');
  await expect(page.locator('header').getByRole('link', { name: 'Sign in' })).toBeVisible();
}

export interface EntryFields {
  status?: string;
  progress?: number | string;
  /** 1 to 10, or '' for not rated. */
  rating?: number | string;
  notes?: string;
  private?: boolean;
}

/** Fill in the library box on a title page and press its button, then wait for the server to answer. */
export async function saveEntry(page: Page, fields: EntryFields) {
  if (fields.status !== undefined) await page.locator('#lib-status').selectOption(fields.status);
  if (fields.progress !== undefined) await page.locator('#lib-progress').fill(String(fields.progress));
  if (fields.rating !== undefined) await page.locator('#lib-rating').selectOption(String(fields.rating));
  if (fields.notes !== undefined) await page.locator('#lib-notes').fill(fields.notes);
  if (fields.private !== undefined) await page.getByLabel('Keep this entry private').setChecked(fields.private);
  const answered = page.waitForResponse((response) => response.request().method() === 'POST');
  await page.getByRole('button', { name: /^(Add to library|Save changes)$/ }).click();
  await answered;
}

/** Test-only switches on the stand-in auth server. */
export async function configureMock(
  request: APIRequestContext,
  config: { requireConfirmation?: boolean; accessTokenTtl?: number; outage?: 'none' | 'database' | 'auth'; recoveryMinInterval?: number },
) {
  const response = await request.post(`${MOCK_ORIGIN}/__test/config`, { data: config });
  expect(response.ok(), 'the stand-in auth server accepted the setting').toBe(true);
}

export async function mockStats(request: APIRequestContext): Promise<{ refreshGrants: number; refreshRejected: number }> {
  return (await request.get(`${MOCK_ORIGIN}/__test/stats`)).json();
}

/** The messages (confirmation and password-reset links) the stand-in "sent" to an address. */
export async function emailsTo(request: APIRequestContext, address: string): Promise<Array<{ to: string; kind: 'signup' | 'recovery'; link: string }>> {
  return (await request.get(`${MOCK_ORIGIN}/__test/emails?to=${encodeURIComponent(address)}`)).json();
}

/**
 * Follow a confirmation link the way a browser would, but only as far as the redirect, and return where it
 * points. The link lives on the auth server; the site's own address is what the visitor ends up opening.
 */
export async function confirmationTarget(request: APIRequestContext, link: string): Promise<string> {
  const response = await request.get(link, { maxRedirects: 0 });
  expect(response.status(), 'the auth server redirects the visitor back to the site').toBe(303);
  const location = response.headers()['location'];
  expect(location).toBeTruthy();
  return location!;
}
