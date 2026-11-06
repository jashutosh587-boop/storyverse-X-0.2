import type { APIRequestContext, Page } from '@playwright/test';
import {
  accountMenu,
  APP_ORIGIN,
  configureMock,
  confirmationTarget,
  emailsTo,
  expect,
  newIdentity,
  newVisitor,
  register,
  signIn,
  signOut,
  test,
} from './support/test';

/** The Next.js route announcer is also role="alert", so every alert is looked up by what it says. */
const alertWith = (page: Page, text: string | RegExp) => page.getByRole('alert').filter({ hasText: text });
const statusWith = (page: Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text });

/** Ask for a reset link the way a member would: from the sign-in page. */
async function askForResetLink(page: Page, address: string) {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/forgot-password`);
  await page.getByLabel('Email address').fill(address);
  await page.getByRole('button', { name: 'Email me a reset link' }).click();
  await expect(statusWith(page, 'Check your email')).toBeVisible();
}

/** What the page said, with the address taken out, so answers for different addresses can be compared. */
async function answerFor(page: Page, address: string) {
  await askForResetLink(page, address);
  return (await statusWith(page, 'Check your email').innerText()).replace(address, '<address>');
}

const resetLinks = async (request: APIRequestContext, address: string) => (await emailsTo(request, address)).filter((mail) => mail.kind === 'recovery');

/** Open the newest reset link for an address, as the same browser that asked for it. */
async function openResetLink(page: Page, request: APIRequestContext, address: string) {
  const mails = await resetLinks(request, address);
  expect(mails.length, 'a reset message was sent').toBeGreaterThan(0);
  const target = await confirmationTarget(request, mails.at(-1)!.link);
  expect(new URL(target).origin).toBe(APP_ORIGIN);
  expect(new URL(target).pathname).toBe('/auth/recovery');
  await page.goto(target);
}

async function chooseNewPassword(page: Page, password: string, confirm = password) {
  await page.getByLabel('New password').fill(password);
  await page.getByLabel('Confirm password').fill(confirm);
  await page.getByRole('button', { name: 'Save new password' }).click();
}

test.describe('a forgotten password', () => {
  test('can be reset from the emailed link, and only the new password works afterwards', async ({ page, request }) => {
    const me = await register(page);
    await signOut(page, me.username);

    await askForResetLink(page, me.email);
    await expect(statusWith(page, 'Check your email')).toContainText(me.email);
    await openResetLink(page, request, me.email);
    await expect(page).toHaveURL(`${APP_ORIGIN}/reset-password`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choose a new password');

    const fresh = 'a brand new passphrase';
    await chooseNewPassword(page, fresh);
    await expect(statusWith(page, 'Password changed')).toBeVisible();
    await expect(accountMenu(page, me.username)).toBeVisible(); // the link signed the member in

    await signOut(page, me.username);
    await signIn(page, me); // the old password is refused
    await expect(alertWith(page, 'The email address or password is not right.')).toBeVisible();
    await signIn(page, { email: me.email, password: fresh });
    await expect(accountMenu(page, me.username)).toBeVisible();
  });

  test('is asked for with the same answer whether or not the address has an account', async ({ page, request }) => {
    const me = await register(page);
    await signOut(page, me.username);
    const stranger = 'nobody.here@example.test';

    const forMember = await answerFor(page, me.email);
    const forStranger = await answerFor(page, stranger);
    expect(forStranger).toBe(forMember);
    expect(forMember).toContain('If an account exists for <address>');

    expect(await resetLinks(request, me.email), 'the member got a link').toHaveLength(1);
    expect(await emailsTo(request, stranger), 'a stranger got nothing').toEqual([]);
  });

  test('is asked for with the same answer when the sending limit applies, because only real accounts have one', async ({ page, request }) => {
    await configureMock(request, { recoveryMinInterval: 600 });
    try {
      const me = await register(page);
      await signOut(page, me.username);

      const first = await answerFor(page, me.email);
      const second = await answerFor(page, me.email); // the auth service refuses this one with a rate-limit error
      const stranger = await answerFor(page, 'someone.else@example.test');
      expect(second).toBe(first);
      expect(stranger).toBe(first);
      expect(await resetLinks(request, me.email), 'the second request sent nothing').toHaveLength(1);
    } finally {
      await configureMock(request, { recoveryMinInterval: 0 });
    }
  });

  test('says when it cannot send, instead of pretending it did', async ({ page, request }) => {
    const me = await register(page);
    await signOut(page, me.username);
    await configureMock(request, { outage: 'auth' });
    try {
      await page.goto('/forgot-password');
      await page.getByLabel('Email address').fill(me.email);
      await page.getByRole('button', { name: 'Email me a reset link' }).click();
      await expect(alertWith(page, 'We could not send the email just now. Try again in a moment.')).toBeVisible();
      await expect(statusWith(page, 'Check your email')).toHaveCount(0);
      await expect(page.getByLabel('Email address')).toHaveValue(me.email);
    } finally {
      await configureMock(request, { outage: 'none' });
    }
    await page.getByRole('button', { name: 'Email me a reset link' }).click(); // and works again once the service is back
    await expect(statusWith(page, 'Check your email')).toBeVisible();
  });

  test('is turned back with an explanation when the link cannot be used', async ({ page, request, browser, problems }) => {
    const me = await register(page);
    await signOut(page, me.username);
    await askForResetLink(page, me.email);
    const target = await confirmationTarget(request, (await resetLinks(request, me.email))[0]!.link);

    // A different browser never asked for this link, so it cannot use it.
    const other = await newVisitor(browser, problems);
    try {
      await other.page.goto(target);
      await expect(other.page).toHaveURL(`${APP_ORIGIN}/forgot-password?error=link`);
      await expect(alertWith(other.page, 'That link did not work.')).toBeVisible();
      await expect(other.page.getByRole('button', { name: 'Email me a reset link' })).toBeVisible();
    } finally {
      await other.context.close();
    }

    // That attempt did not spend it: the browser that asked can still use it, once.
    await page.goto(target);
    await expect(page).toHaveURL(`${APP_ORIGIN}/reset-password`);
    await chooseNewPassword(page, 'another good passphrase');
    await expect(statusWith(page, 'Password changed')).toBeVisible();
    await signOut(page, me.username);

    const again = await confirmationTarget(request, (await resetLinks(request, me.email))[0]!.link);
    await page.goto(again);
    await expect(page).toHaveURL(`${APP_ORIGIN}/forgot-password?error=link`);
    await expect(alertWith(page, 'That link did not work.')).toBeVisible();
  });

  test('checks the new password before saving it', async ({ page, request }) => {
    const me = await register(page);
    await signOut(page, me.username);
    await askForResetLink(page, me.email);
    await openResetLink(page, request, me.email);

    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.locator('#password-error')).toHaveText('Use at least 8 characters.');

    await chooseNewPassword(page, 'short');
    await expect(page.locator('#password-error')).toHaveText('Use at least 8 characters.');

    await chooseNewPassword(page, 'long enough one', 'something else entirely');
    await expect(page.locator('#confirm-error')).toHaveText('The two passwords do not match.');

    await chooseNewPassword(page, me.password); // what it is now
    await expect(page.locator('#password-error')).toHaveText('That is your current password. Choose a different one.');

    await chooseNewPassword(page, 'the one that is accepted');
    await expect(statusWith(page, 'Password changed')).toBeVisible();
  });

  test('is only offered to someone who followed a reset link', async ({ page }) => {
    await page.goto('/reset-password');
    await expect(page).toHaveURL(`${APP_ORIGIN}/forgot-password?error=link`);
    await expect(alertWith(page, 'That link did not work.')).toBeVisible();
  });

  test('can be reset from Settings by someone who is signed in', async ({ page, request }) => {
    const me = await register(page);
    await page.goto('/settings');
    await page.getByRole('link', { name: 'Email me a link to change it' }).click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/forgot-password`);
    await page.getByLabel('Email address').fill(me.email);
    await page.getByRole('button', { name: 'Email me a reset link' }).click();
    await expect(statusWith(page, 'Check your email')).toBeVisible();

    await openResetLink(page, request, me.email);
    await expect(page).toHaveURL(`${APP_ORIGIN}/reset-password`);
    await chooseNewPassword(page, 'changed from settings');
    await expect(statusWith(page, 'Password changed')).toBeVisible();
    await expect(accountMenu(page, me.username)).toBeVisible();
  });
});

test.describe('when the project requires the email address to be confirmed', () => {
  test.beforeEach(async ({ request }) => configureMock(request, { requireConfirmation: true }));
  test.afterEach(async ({ request }) => configureMock(request, { requireConfirmation: false }));

  test('a reset link also confirms an account whose confirmation link expired', async ({ page, request }) => {
    const me = newIdentity();
    await page.goto('/signup');
    await page.getByLabel('Email address').fill(me.email);
    await page.getByLabel('Username').fill(me.username);
    await page.getByLabel('Password').fill(me.password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(statusWith(page, 'Check your email')).toContainText(me.email);

    // The confirmation link is never opened (it was lost, or it expired). Signing in explains what to do.
    await signIn(page, me);
    await expect(alertWith(page, 'Confirm your email address first.')).toContainText('Forgot your password?');

    await askForResetLink(page, me.email);
    await openResetLink(page, request, me.email);
    await expect(page).toHaveURL(`${APP_ORIGIN}/reset-password`);
    await chooseNewPassword(page, 'now it is confirmed');
    await expect(statusWith(page, 'Password changed')).toBeVisible();
    await expect(accountMenu(page, me.username)).toBeVisible(); // with the username chosen at sign-up

    await signOut(page, me.username);
    await signIn(page, { email: me.email, password: 'now it is confirmed' });
    await expect(accountMenu(page, me.username)).toBeVisible();
  });
});
