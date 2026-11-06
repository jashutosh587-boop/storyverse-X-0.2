import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import {
  accountMenu,
  APP_ORIGIN,
  chooseFromAccountMenu,
  configureMock,
  confirmationTarget,
  emailsTo,
  expect,
  mockStats,
  newIdentity,
  newVisitor,
  register,
  saveEntry,
  signIn,
  signOut,
  test,
  titleHref,
} from './support/test';

/** The Next.js route announcer is also role="alert", so every alert is looked up by what it says. */
const alertWith = (page: Page, text: string | RegExp) => page.getByRole('alert').filter({ hasText: text });
const statusWith = (page: Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text });
/** Ask for the data export from inside the page, which sends the page's cookies (Playwright's own request client does not send Secure ones over http). */
const exportFromBrowser = (page: Page) =>
  page.evaluate(async () => {
    const response = await fetch('/settings/export');
    return {
      status: response.status,
      cache: response.headers.get('cache-control'),
      disposition: response.headers.get('content-disposition'),
      type: response.headers.get('content-type'),
    };
  });
const membersPanel = (page: Page) => page.locator('section[aria-label="Scores"] .panel', { hasText: 'Storyverse members' });

test.describe('creating an account', () => {
  test('explains each problem beside the field it belongs to, and keeps what was typed', async ({ page }) => {
    await page.goto('/signup');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('#email-error')).toHaveText('Enter your email address.');
    await expect(page.locator('#username-error')).toHaveText('Use 3 to 24 letters, numbers or underscores.');
    await expect(page.locator('#password-error')).toHaveText('Use at least 8 characters.');
    await expect(page.getByLabel('Email address')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Email address')).toHaveAccessibleDescription('Enter your email address.');

    await page.getByLabel('Email address').fill('not-an-email');
    await page.getByLabel('Username').fill('a b');
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('#email-error')).toHaveText('Enter a valid email address.');
    await expect(page.locator('#username-error')).toHaveText('Use 3 to 24 letters, numbers or underscores.');
    await expect(page.locator('#password-error')).toHaveText('Use at least 8 characters.');
    await expect(page.getByLabel('Email address')).toHaveValue('not-an-email');
    await expect(page.getByLabel('Username')).toHaveValue('a b');
    await expect(page.getByLabel('Password')).toHaveValue(''); // a password is never sent back to the page

    await page.getByLabel('Password').fill('x'.repeat(73));
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('#password-error')).toHaveText('Use 72 characters or fewer.');
  });

  test('registers and signs the member in, then keeps signed-in visitors off the sign-up and sign-in forms', async ({ page }) => {
    const me = await register(page);
    await expect(page).toHaveURL(`${APP_ORIGIN}/`);

    for (const path of ['/signup', '/login']) {
      await page.goto(path);
      await expect(page).toHaveURL(`${APP_ORIGIN}/`);
    }
    await page.goto('/signup?next=%2Fanime');
    await expect(page).toHaveURL(`${APP_ORIGIN}/anime`);

    // A new member has a public profile straight away, and nothing is made up for it.
    await page.goto(`/u/${me.username}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(me.username);
    await expect(page.getByText('Your library is empty')).toBeVisible();
  });

  test('refuses a username that is taken in any capitalisation, and an email that is already registered', async ({ page, browser, problems }) => {
    const first = await register(page);
    const visitor = await newVisitor(browser, problems);
    try {
      const other = newIdentity();
      await visitor.page.goto('/signup');
      await visitor.page.getByLabel('Email address').fill(other.email);
      await visitor.page.getByLabel('Username').fill(first.username.toUpperCase());
      await visitor.page.getByLabel('Password').fill(other.password);
      await visitor.page.getByRole('button', { name: 'Create account' }).click();
      await expect(visitor.page.locator('#username-error')).toHaveText('That username is taken. Try another.');
      await expect(visitor.page.locator('header').getByRole('link', { name: 'Sign in' })).toBeVisible(); // nobody was signed in by mistake

      await visitor.page.getByLabel('Username').fill(newIdentity().username);
      await visitor.page.getByLabel('Email address').fill(first.email);
      await visitor.page.getByLabel('Password').fill(other.password);
      await visitor.page.getByRole('button', { name: 'Create account' }).click();
      await expect(alertWith(visitor.page, 'We could not create that account')).toBeVisible();
    } finally {
      await visitor.context.close();
    }
  });
});

test.describe('signing in and out', () => {
  test('a wrong password and an unknown address get the same answer', async ({ page }) => {
    const me = await register(page);
    await signOut(page, me.username);
    const answer = 'The email address or password is not right.';

    await signIn(page, { email: me.email, password: 'not the password' });
    await expect(alertWith(page, answer)).toBeVisible();
    await expect(page.getByLabel('Email address')).toHaveValue(me.email);
    await expect(page.getByLabel('Password')).toHaveValue('');

    await signIn(page, { email: 'nobody.at.all@example.test', password: 'whatever it is' });
    await expect(alertWith(page, answer)).toBeVisible();

    await signIn(page, { email: '', password: '' });
    await expect(page.locator('#email-error')).toHaveText('Enter your email address.');
    await expect(page.locator('#password-error')).toHaveText('Enter your password.');

    await signIn(page, me);
    await expect(accountMenu(page, me.username)).toBeVisible();
  });

  test('sign-in returns to the page that asked for it, and never to another site', async ({ page }) => {
    const me = await register(page);
    await signOut(page, me.username);

    await page.goto('/library');
    await expect(page).toHaveURL(`${APP_ORIGIN}/login?next=%2Flibrary`);
    await page.getByLabel('Email address').fill(me.email);
    await page.getByLabel('Password').fill(me.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/library`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your library');
    await signOut(page, me.username);

    // Anything that is not a plain path on this site is ignored. The browser guard fails the test if it is ever followed.
    for (const target of ['//evil.example/phish', '/..//evil.example', '/\\evil.example', 'https://evil.example/', 'javascript:alert(1)', 'http://127.0.0.1:3100@evil.example/']) {
      await signIn(page, me, target);
      await expect(page, `after signing in with next=${target}`).toHaveURL(`${APP_ORIGIN}/`);
      await expect(accountMenu(page, me.username)).toBeVisible();
      await page.goto(`/login?next=${encodeURIComponent(target)}`); // already signed in: same answer
      await expect(page, `signed-in visit with next=${target}`).toHaveURL(`${APP_ORIGIN}/`);
      await signOut(page, me.username);
    }
  });

  test('signing out ends the session on this browser', async ({ page, context, problems }) => {
    const me = await register(page);
    await page.goto('/library');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your library');

    await signOut(page, me.username);
    await expect(page).toHaveURL(`${APP_ORIGIN}/`);
    await expect(accountMenu(page, me.username)).toHaveCount(0);
    expect((await context.cookies()).filter((cookie) => /auth-token$/.test(cookie.name))).toEqual([]);

    await page.goto('/library');
    await expect(page).toHaveURL(`${APP_ORIGIN}/login?next=%2Flibrary`);
    expect((await exportFromBrowser(page)).status).toBe(401);
    problems.length = 0; // Chromium logs the 401 as a resource error, and that is the answer we asked for
  });
});

test.describe('the library', () => {
  test('tracks a title from start to finish, and the database enforces the rules', async ({ page }) => {
    const me = await register(page);
    await page.goto(await titleHref(page, 'Cowboy Bebop'));
    await expect(page.getByRole('heading', { name: 'Add to your library' })).toBeVisible();
    await expect(page.getByText('This title has 26 episodes.')).toBeVisible();

    await saveEntry(page, { status: 'in_progress', progress: 12, rating: 9, notes: 'Rewatching with friends.' });
    await expect(statusWith(page, 'Saved to your library.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'In your library' })).toBeVisible();

    // It survives a reload, exactly as saved.
    await page.reload();
    await expect(page.locator('#lib-status')).toHaveValue('in_progress');
    await expect(page.locator('#lib-progress')).toHaveValue('12');
    await expect(page.locator('#lib-rating')).toHaveValue('9');
    await expect(page.locator('#lib-notes')).toHaveValue('Rewatching with friends.');

    // The rating is now the community's, says so, and leaves the source's own score alone.
    await expect(membersPanel(page)).toContainText('Average of 1 rating');
    await expect(membersPanel(page).getByRole('img')).toHaveAccessibleName('Ratings by score: 1 gave 9');
    await expect(page.getByText('8.75', { exact: true })).toBeVisible();

    // Past the end is stopped by the browser, and by the database when the browser is out of the way.
    const progress = page.locator('#lib-progress');
    await progress.fill('30');
    expect(await progress.evaluate((input: HTMLInputElement) => input.validity.rangeOverflow)).toBe(true);
    await progress.evaluate((input: HTMLInputElement) => input.removeAttribute('max'));
    await saveEntry(page, {});
    await expect(statusWith(page, 'That is more than this title has in total. Lower the number.')).toBeVisible();
    await page.reload();
    await expect(page.locator('#lib-progress')).toHaveValue('12'); // the refused save changed nothing

    // Finishing a title fills its progress.
    await saveEntry(page, { status: 'completed' });
    await expect(page.locator('#lib-progress')).toHaveValue('26');

    await chooseFromAccountMenu(page, me.username, 'Your library');
    await expect(page).toHaveURL(`${APP_ORIGIN}/library`);
    const row = page.locator('main li', { hasText: 'Cowboy Bebop' });
    await expect(row).toContainText('Completed');
    await expect(row).toContainText('9 out of 10');
    await expect(row).toContainText('26 of 26 episodes');
    await expect(row).toContainText('Rewatching with friends.');
    const tabs = page.getByRole('navigation', { name: 'Filter by status' });
    await expect(tabs.getByRole('link')).toHaveText([/^All\s*1$/, /^Completed\s*1$/]);

    await page.goto('/library?status=dropped');
    await expect(page.getByRole('heading', { name: 'Nothing with that status' })).toBeVisible();
    await page.getByRole('link', { name: 'Show your whole library' }).click();
    await expect(page.locator('main li', { hasText: 'Cowboy Bebop' })).toBeVisible();
  });

  test('removing an entry takes its rating out of the community average and empties the library', async ({ page }) => {
    await register(page);
    await page.goto(await titleHref(page, 'Berserk'));
    await saveEntry(page, { status: 'planned', rating: 8 });
    await page.reload();
    await expect(membersPanel(page)).toContainText('Average of 1 rating');

    await page.getByRole('button', { name: 'Remove from library' }).click();
    await expect(statusWith(page, 'Removed from your library.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add to your library' })).toBeVisible();
    await expect(page.getByText('Nobody has rated this yet')).toBeVisible();

    await page.goto('/library');
    await expect(page.getByRole('heading', { name: 'Your library is empty' })).toBeVisible();
  });
});

test.describe('privacy', () => {
  test('a public profile shows public entries only and never notes; a private entry still counts in the average, without a name', async ({
    page,
    browser,
    problems,
  }) => {
    const alice = await register(page);
    const shown = await titleHref(page, 'E2E Test Anime 002');
    const hidden = await titleHref(page, 'E2E Test Anime 003');
    await page.goto(shown);
    await saveEntry(page, { status: 'completed', rating: 9, notes: 'ALICE-PUBLIC-NOTE' });
    await page.goto(hidden);
    await saveEntry(page, { status: 'planned', rating: 8, notes: 'ALICE-PRIVATE-NOTE', private: true });

    const visitor = await newVisitor(browser, problems);
    try {
      await visitor.page.goto(`/u/${alice.username}`);
      const main = visitor.page.getByRole('main');
      await expect(main.getByRole('link', { name: 'E2E Test Anime 002' })).toBeVisible();
      await expect(main).not.toContainText('E2E Test Anime 003');
      await expect(main).not.toContainText('ALICE-PUBLIC-NOTE');
      await expect(main).not.toContainText('ALICE-PRIVATE-NOTE');
      await expect(visitor.page.getByRole('navigation', { name: 'Filter by status' }).getByRole('link', { name: /^All\s*1$/ })).toBeVisible();

      // The private rating is in the title's average, but nothing on the page says whose it is.
      await visitor.page.goto(hidden);
      await expect(membersPanel(visitor.page)).toContainText('Average of 1 rating');
      await expect(visitor.page.locator('body')).not.toContainText(alice.username);
      await expect(visitor.page.locator('body')).not.toContainText('ALICE-PRIVATE-NOTE');

      // The owner sees everything of hers, and is told what others do not.
      await page.goto(`/u/${alice.username}`);
      await expect(page.getByRole('main')).toContainText('E2E Test Anime 003');
      await expect(page.getByRole('main')).toContainText('Private');
      await expect(page.getByText('Other people see this page without your notes and without the entries marked Private.')).toBeVisible();

      // Hiding the profile removes the page for everyone else, and changes nothing for her.
      await page.goto('/settings');
      await page.getByLabel('Public profile').setChecked(false);
      await page.getByRole('button', { name: 'Save profile' }).click();
      await expect(statusWith(page, 'Profile saved.')).toBeVisible();

      expect((await visitor.page.goto(`/u/${alice.username}`))?.status()).toBe(404);
      problems.length = 0; // Chromium logs each navigation to a 404 as a resource error
      await page.goto(`/u/${alice.username}`);
      await expect(page.getByText('Your profile is private, so only you can see this page.')).toBeVisible();
      await expect(page.getByRole('main')).toContainText('ALICE-PUBLIC-NOTE');
    } finally {
      await visitor.context.close();
    }
  });
});

test.describe('the profile', () => {
  test('a page number past the end lands on the last page instead of an empty one', async ({ page }) => {
    const me = await register(page);
    await page.goto(`/u/${me.username}?page=99`);
    await expect(page).toHaveURL(`${APP_ORIGIN}/u/${me.username}`);
    await page.goto(`/u/${me.username}?status=dropped&page=3`);
    await expect(page).toHaveURL(`${APP_ORIGIN}/u/${me.username}?status=dropped`);
  });

  test('changes show on the public page, and usernames cannot clash', async ({ page, browser, problems }) => {
    const alice = await register(page);
    const bob = newIdentity('bob');
    const visitor = await newVisitor(browser, problems);
    try {
      await register(visitor.page, bob);

      await page.goto('/settings');
      await page.getByLabel('Display name').fill('Alice Example');
      await page.getByLabel('Bio', { exact: true }).fill('Reads too much.\nWatches too much.');
      await page.getByRole('button', { name: 'Save profile' }).click();
      await expect(statusWith(page, 'Profile saved.')).toBeVisible();

      await visitor.page.goto(`/u/${alice.username}`);
      await expect(visitor.page.getByRole('heading', { level: 1 })).toHaveText('Alice Example');
      await expect(visitor.page.getByText(`@${alice.username}, member since`)).toBeVisible();
      await expect(visitor.page.getByText('Reads too much.')).toBeVisible();
      await expect(visitor.page.getByText('Watches too much.')).toBeVisible();

      // Somebody else's username is refused, in any capitalisation.
      await page.goto('/settings');
      await page.getByLabel('Username', { exact: true }).fill(bob.username.toUpperCase());
      await page.getByRole('button', { name: 'Save profile' }).click();
      await expect(page.locator('#p-username-error')).toHaveText('That username is taken. Try another.');

      // A free one is accepted; the address moves with it and the header follows.
      const renamed = newIdentity('renamed').username;
      await page.getByLabel('Username', { exact: true }).fill(renamed);
      await page.getByRole('button', { name: 'Save profile' }).click();
      await expect(accountMenu(page, renamed)).toBeVisible();
      expect((await visitor.page.goto(`/u/${alice.username}`))?.status()).toBe(404);
      problems.length = 0;
      expect((await visitor.page.goto(`/u/${renamed}`))?.status()).toBe(200);
    } finally {
      await visitor.context.close();
    }
  });
});

test.describe('your data', () => {
  test('can be downloaded, notes included, and is never cached', async ({ page }) => {
    const me = await register(page);
    await page.goto(await titleHref(page, 'Dune'));
    await saveEntry(page, { status: 'planned', notes: 'Borrowed from the library.', private: true });

    await page.goto('/settings');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download my data' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^storyverse-export-\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(await readFile((await download.path())!, 'utf8')) as {
      account: { email: string; created_at: string };
      profile: { username: string };
      library: Array<Record<string, unknown>>;
    };
    expect(data.account.email, 'the email address is part of what the site holds').toBe(me.email);
    expect(new Date(data.account.created_at).getTime()).not.toBeNaN();
    expect(data.profile.username).toBe(me.username);
    expect(data.library).toHaveLength(1);
    expect(data.library[0]).toMatchObject({ title: 'Dune', status: 'planned', notes: 'Borrowed from the library.', is_private: true });
    expect(data.library[0]).not.toHaveProperty('user_id');

    expect(await exportFromBrowser(page)).toEqual({
      status: 200,
      cache: 'private, no-store',
      disposition: expect.stringMatching(/^attachment; filename="storyverse-export-/),
      type: 'application/json; charset=utf-8',
    });
  });

  test('deleting the account needs the username typed, then removes the profile, library and ratings', async ({ page, browser, problems }) => {
    const alice = await register(page);
    const bob = newIdentity('bob');
    const watcher = await newVisitor(browser, problems);
    try {
      await register(watcher.page, bob);
      const rated = await titleHref(page, 'E2E Test Anime 004');
      await page.goto(rated);
      await saveEntry(page, { status: 'completed', rating: 9 });
      await watcher.page.goto(rated);
      await saveEntry(watcher.page, { status: 'completed', rating: 5 });
      await watcher.page.reload();
      await expect(membersPanel(watcher.page)).toContainText('Average of 2 ratings');
      await expect(membersPanel(watcher.page)).toContainText(/^Storyverse members\s*7\s*out of 10/);

      await page.goto('/settings');
      await page.getByLabel(/Type your username/).fill('somebody_else');
      await page.getByRole('button', { name: 'Delete my account permanently' }).click();
      await expect(alertWith(page, `Type ${alice.username} to confirm.`)).toBeVisible();
      await expect(accountMenu(page, alice.username)).toBeVisible(); // nothing happened

      await page.getByLabel(/Type your username/).fill(alice.username);
      await page.getByRole('button', { name: 'Delete my account permanently' }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/?account=deleted`);
      await expect(statusWith(page, 'Your account and everything attached to it has been deleted.')).toBeVisible();
      await expect(page.locator('header').getByRole('link', { name: 'Sign in' })).toBeVisible();

      // Gone for good: she cannot sign in, her page is a 404, and her rating left the average with her.
      await signIn(page, alice);
      await expect(alertWith(page, 'The email address or password is not right.')).toBeVisible();
      expect((await watcher.page.goto(`/u/${alice.username}`))?.status()).toBe(404);
      problems.length = 0;
      await watcher.page.goto(rated);
      await expect(membersPanel(watcher.page)).toContainText('Average of 1 rating');
      await expect(membersPanel(watcher.page)).toContainText(/^Storyverse members\s*5\s*out of 10/);
    } finally {
      await watcher.context.close();
    }
  });
});

test.describe('when the project requires the email address to be confirmed', () => {
  test.beforeEach(async ({ request }) => configureMock(request, { requireConfirmation: true }));
  test.afterEach(async ({ request }) => configureMock(request, { requireConfirmation: false }));

  async function signUpOnly(page: Page, identity: { email: string; username: string; password: string }) {
    await page.goto('/signup');
    await page.getByLabel('Email address').fill(identity.email);
    await page.getByLabel('Username').fill(identity.username);
    await page.getByLabel('Password').fill(identity.password);
    await page.getByRole('button', { name: 'Create account' }).click();
    const notice = statusWith(page, 'Check your email');
    await expect(notice).toContainText(identity.email);
    await expect(page.locator('header').getByRole('link', { name: 'Sign in' })).toBeVisible(); // not signed in yet
  }

  test('the emailed link finishes the sign-up, and works once', async ({ page, request }) => {
    const me = newIdentity();
    await signUpOnly(page, me);

    // Until the link is opened, signing in is refused with a reason that helps.
    await signIn(page, me);
    await expect(alertWith(page, 'Confirm your email address first.')).toBeVisible();

    const [mail] = await emailsTo(request, me.email);
    expect(mail, 'a confirmation message was sent').toBeDefined();
    const target = await confirmationTarget(request, mail!.link);
    expect(new URL(target).origin).toBe(APP_ORIGIN);
    expect(new URL(target).pathname).toBe('/auth/callback');

    await page.goto(target);
    await expect(page).toHaveURL(`${APP_ORIGIN}/`);
    await expect(accountMenu(page, me.username)).toBeVisible();

    // The link cannot be used a second time.
    const again = await confirmationTarget(request, mail!.link);
    await signOut(page, me.username);
    await page.goto(again);
    await expect(page).toHaveURL(`${APP_ORIGIN}/login?error=callback`);
    await expect(alertWith(page, 'That confirmation link did not work.')).toBeVisible();
  });

  test('a link opened in a different browser explains itself, and the account works once confirmed', async ({ page, request, browser, problems }) => {
    const me = newIdentity();
    await signUpOnly(page, me);
    const [mail] = await emailsTo(request, me.email);
    const target = await confirmationTarget(request, mail!.link);

    const other = await newVisitor(browser, problems);
    try {
      await other.page.goto(target); // this browser never started the sign-up, so it cannot finish it
      await expect(other.page).toHaveURL(`${APP_ORIGIN}/login?error=callback`);
      await expect(alertWith(other.page, 'That confirmation link did not work.')).toBeVisible();

      // The address was confirmed when the link was opened, so the password works now.
      await other.page.getByLabel('Email address').fill(me.email);
      await other.page.getByLabel('Password').fill(me.password);
      await other.page.getByRole('button', { name: 'Sign in' }).click();
      await expect(accountMenu(other.page, me.username)).toBeVisible();
    } finally {
      await other.context.close();
    }
  });
});

test.describe('sessions', () => {
  test('signing out ends this browser\'s session and leaves the same member signed in on another device', async ({ page, request, browser, problems }) => {
    // Short-lived access tokens make the other browser prove its session with the auth service on its next request.
    await configureMock(request, { accessTokenTtl: 92 });
    const other = await newVisitor(browser, problems);
    try {
      const me = await register(page);
      await signIn(other.page, me);
      await expect(accountMenu(other.page, me.username)).toBeVisible();
      await page.waitForTimeout(2300);

      await signOut(page, me.username);
      await expect(accountMenu(page, me.username)).toHaveCount(0);

      await other.page.goto('/library'); // renews its token, which only works while its own session exists
      await expect(other.page.getByRole('heading', { level: 1 })).toHaveText('Your library');
      await expect(accountMenu(other.page, me.username)).toBeVisible();
    } finally {
      await other.context.close();
      await configureMock(request, { accessTokenTtl: 3600 });
    }
  });

  test('an expiring access token is renewed by the first request that needs it, and the new one reaches the browser', async ({
    page,
    request,
    context,
  }) => {
    // The auth client treats a token as expiring 90 seconds before its end, so a 92-second token is due for renewal two seconds
    // after it is issued. (A lifetime under 90 seconds would make every single call renew, which no hosted project is set up for.)
    await configureMock(request, { accessTokenTtl: 92 });
    const due = () => page.waitForTimeout(2300);
    const sessionCookie = async () => (await context.cookies()).find((cookie) => /^sb-.*-auth-token$/.test(cookie.name))?.value;
    try {
      const me = await register(page);
      const before = await mockStats(request);
      let previous = await sessionCookie();
      expect(previous, 'a session cookie was set').toBeTruthy();

      for (const path of ['/library', '/settings', '/anime', '/library']) {
        await due();
        await page.goto(path);
        await expect(accountMenu(page, me.username)).toBeVisible();
        const current = await sessionCookie();
        expect(current, `the renewed session reached the browser on ${path}`).not.toBe(previous);
        previous = current;
      }

      // A form submission goes through the same renewal, and the member's work is saved.
      await page.goto(await titleHref(page, 'E2E Test Anime 005'));
      await due();
      await saveEntry(page, { status: 'planned', rating: 7 });
      await expect(statusWith(page, 'Saved to your library.')).toBeVisible();
      expect(await sessionCookie(), 'the renewed session reached the browser after a form submission').not.toBe(previous);
      await page.goto('/library');
      await expect(page.locator('main li', { hasText: 'E2E Test Anime 005' })).toContainText('7 out of 10');
      await expect(accountMenu(page, me.username)).toBeVisible();

      const after = await mockStats(request);
      expect(after.refreshGrants - before.refreshGrants, 'tokens were renewed along the way').toBeGreaterThanOrEqual(5);
      // A refresh token works once. If the site ever sent one a second time, a hosted project would treat it as theft.
      expect(after.refreshRejected - before.refreshRejected, 'refresh tokens the site sent twice').toBe(0);
    } finally {
      await configureMock(request, { accessTokenTtl: 3600 });
    }
  });
});
