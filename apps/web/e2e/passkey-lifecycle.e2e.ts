import { expect, test, type Page } from '@playwright/test';
import {
  emailedLink,
  freshEmail,
  origin,
  resetRateLimits,
  signUpMember,
  uniqueName,
  addPasskeyFromSettings,
  confirmSignIn,
  passkeySignInAfterSignOut,
  requestSignInLink,
} from './support/accounts';
import { expectFocusOn, pressByKeyboard } from './support/focus';
import { effectsRan } from './support/hydration';
import { removeRowByClick, securityRows } from './support/security-rows';
import {
  addVirtualAuthenticator,
  savePasskeyOffer,
  withoutPasskeyAutofill,
} from './support/webauthn';

/**
 * Real Chromium virtual WebAuthn authenticators (CDP
 * `WebAuthn.addVirtualAuthenticator`) driving the actual passkey plugin
 * ceremonies over the production build (AUTH-5.1..5.6). Account setup uses
 * the real `/api/auth` and `/auth/confirm` handlers through `signUpMember`
 * (an isolated, labeled non-login helper: the subject under test here is
 * passkeys, not the sign-up journey itself, which `journey.e2e.ts` already
 * proves). CDP WebAuthn is Chromium-only, so this whole file is
 * Chromium-only too (`playwright.config.ts` testIgnore); sessions and
 * email change use no WebAuthn and run cross-browser from
 * `email-change-and-sessions.e2e.ts` instead (ISSUE-167).
 */
test.beforeEach(async ({ request }) => {
  await resetRateLimits(request);
});

/** The account's passkeys as the server lists them, for the page's session. */
async function listedPasskeys(page: Page) {
  const response = await page.request.get(
    '/api/auth/passkey/list-user-passkeys',
  );
  expect(response.status()).toBe(200);
  return (await response.json()) as readonly { readonly id: string }[];
}

/**
 * Removes the account's only passkey from settings. The server must stop
 * listing it: a remove that never reached it (or that it refused) leaves the
 * row gone on screen but the passkey still listed, and fails here.
 */
async function removeOnlyPasskey(page: Page) {
  expect(await listedPasskeys(page)).toHaveLength(1);
  await removeRowByClick(
    securityRows(page, 'Passkeys'),
    page.getByRole('button', { name: 'Remove' }),
    1,
  );
  expect(await listedPasskeys(page)).toEqual([]);
}

test('a passkey saved during onboarding is usable to sign back in later', async ({
  page,
  request,
}) => {
  await withoutPasskeyAutofill(page);
  await addVirtualAuthenticator(page);
  await page.goto('/sign-in');
  const email = freshEmail();
  await requestSignInLink(page, email);
  await confirmSignIn(page, await emailedLink(request, email));

  await page.getByLabel('Username').fill(uniqueName('ada'));
  await page.getByRole('button', { name: 'Continue' }).click();
  await savePasskeyOffer(page);
  await expect(page).toHaveURL(/\/lobby$/);

  // The onboarding save used the real ceremony (not the stage-4 stub): the
  // account now owns exactly one passkey.
  await page.goto('/settings/security');
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(1);

  // A merely listed credential could still be unusable; prove it actually
  // authenticates by signing out and back in with it.
  await passkeySignInAfterSignOut(page);
});

test('a passkey enrolled from settings can sign back in after signing out, and lands on the validated destination', async ({
  page,
}) => {
  await withoutPasskeyAutofill(page);
  await addVirtualAuthenticator(page);
  await signUpMember(page.request);

  await page.goto('/settings/security');
  await expect(page.getByRole('heading', { name: 'Passkeys' })).toBeVisible();
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByRole('button', { name: 'Rename' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  await page.goto('/sign-in?next=%2Flobby');
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page).toHaveURL(/\/lobby$/);
});

test('completing onboarding and saving a passkey from a protected page other than /lobby returns there (AUTH-4.1-AC2 passkey leg, AUTH-4.3-AC3, ISSUE-159)', async ({
  page,
  request,
}) => {
  await withoutPasskeyAutofill(page);
  await addVirtualAuthenticator(page);
  await page.goto('/ranked');
  await expect(page).toHaveURL(/\/sign-in\?next=(\/|%2F)ranked$/);

  const email = freshEmail();
  await requestSignInLink(page, email);
  await confirmSignIn(page, await emailedLink(request, email));
  await expect(page).toHaveURL(/\/onboarding\/username\?next=(\/|%2F)ranked$/);

  await page.getByLabel('Username').fill(uniqueName('destined'));
  await page.getByRole('button', { name: 'Continue' }).click();
  await savePasskeyOffer(page);
  await expect(page).toHaveURL(/\/ranked$/);
});

test('a returning user who starts from a protected page other than /lobby returns there after signing in with a passkey (AUTH-5.2-AC3, ISSUE-159)', async ({
  page,
}) => {
  await withoutPasskeyAutofill(page);
  await addVirtualAuthenticator(page);
  await signUpMember(page.request);
  await addPasskeyFromSettings(page);

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForURL(/\/sign-in$/);
  await page.goto('/ranked');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Franked$/);
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page).toHaveURL(/\/ranked$/);
});

test('an enrolled passkey can be renamed and removed from settings', async ({
  page,
}) => {
  await addVirtualAuthenticator(page);
  await signUpMember(page.request);
  await page.goto('/settings/security');

  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(1);

  const nameField = page.locator('input[id^="passkey-name-"]').first();
  await nameField.fill('Work laptop');
  await page.getByRole('button', { name: 'Rename' }).first().click();
  // Rename disables the button once the field matches the stored name; that
  // only happens once the server confirms the new name round-tripped back.
  await expect(page.getByRole('button', { name: 'Rename' })).toBeDisabled();
  await expect(nameField).toHaveValue('Work laptop');

  await removeOnlyPasskey(page);
});

test('removing the last passkey, recovering by magic link and enrolling a replacement chains into one working journey', async ({
  page,
  request,
}) => {
  await withoutPasskeyAutofill(page);
  const lost = await addVirtualAuthenticator(page);
  const { email } = await signUpMember(page.request);
  await page.goto('/settings/security');
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();

  await removeOnlyPasskey(page);
  // The device itself is gone, not just the server-side record: without
  // this, the removed credential would still sit in the browser's
  // credential store and could shadow the replacement below.
  await lost.session.send('WebAuthn.removeVirtualAuthenticator', {
    authenticatorId: lost.authenticatorId,
  });

  // The button's own click handler navigates to /sign-in once sign-out
  // resolves; racing it with an explicit page.goto risks aborting whichever
  // navigation loses, so wait for it to land instead of re-navigating.
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForURL(/\/sign-in$/);
  await requestSignInLink(page, email);
  await confirmSignIn(page, await emailedLink(request, email));
  await expect(page).toHaveURL(/\/lobby$/);

  // The compound claim (recover, then be able to enroll a replacement) is
  // only proven by chaining the replacement enrollment onto this same
  // recovered session, not by exercising enrollment in isolation elsewhere.
  // A new device for the replacement, distinct from the one just lost.
  await addVirtualAuthenticator(page);
  await addPasskeyFromSettings(page);

  // A merely listed replacement could still be unusable; prove it actually
  // authenticates by signing out and back in with it.
  await passkeySignInAfterSignOut(page);
});

test('a lost passkey recovers through magic link, and the recovered session can remove the stale credential and revoke the old device', async ({
  page,
  request,
  browser,
}) => {
  // The original device: enrolls a passkey and stays signed in (never
  // removes it — the credential is simply lost, not revoked).
  await addVirtualAuthenticator(page);
  const { email } = await signUpMember(page.request);
  await addPasskeyFromSettings(page);

  // A brand-new browser context with no authenticator at all stands in for
  // the replacement device the person now owns: the lost credential simply
  // is not there to offer, so the person falls back to the emailed link
  // without ever touching the passkey button.
  const lost = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: origin,
  });
  const lostPage = await lost.newPage();
  await lostPage.goto('/sign-in?next=%2Flobby');

  // Recovery: the verified email still reaches the account.
  await requestSignInLink(lostPage, email);
  await confirmSignIn(lostPage, await emailedLink(request, email));
  await expect(lostPage).toHaveURL(/\/lobby$/);

  // From the recovered session: remove the now-unreachable credential and
  // revoke every other session, including the original device's.
  await lostPage.goto('/settings/security');
  await removeOnlyPasskey(lostPage);
  await lostPage
    .getByRole('button', { name: 'Sign out of all other sessions' })
    .click();
  await expect(
    lostPage.getByRole('button', { name: 'Sign out', exact: true }),
  ).toHaveCount(1);

  // The original (lost) device's session is denied on its very next request,
  // and magic-link access still works for it going forward.
  await page.goto('/lobby');
  await expect(page).toHaveURL(/\/sign-in/);
  await lost.close();
});

test('a cancelled passkey ceremony returns keyboard focus to the email field', async ({
  page,
}) => {
  // ISSUE-118: the button is disabled while the ceremony runs, which drops
  // focus; the settled notice hands it back (answer-focus.e2e.ts proves
  // the unsupported and failed endings on every engine).
  await withoutPasskeyAutofill(page);
  await addVirtualAuthenticator(page);
  await page.goto('/sign-in');
  await effectsRan(page);
  await pressByKeyboard(
    page.getByRole('button', { name: 'Sign in with a passkey' }),
  );
  await expect(page.getByText('No passkey used.')).toBeVisible();
  await expectFocusOn(page, 'input', 'sign-in-email');
});

test('a cancelled passkey ceremony shows no success and email sign-in still works', async ({
  page,
  request,
}) => {
  // A virtual authenticator with no credential: the browser has nothing to
  // offer, which is how a dismissed prompt or an unenrolled account looks.
  // Moved here from journey.e2e.ts (AUTH-6.6): CDP WebAuthn is
  // Chromium-only, and this file is the Chromium-only passkey project.
  await addVirtualAuthenticator(page);
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  const notice = page.getByRole('status').filter({
    hasText: /no passkey used/i,
  });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(/continue with your email/i);
  await expect(page).toHaveURL(/\/sign-in$/);

  const email = freshEmail();
  await requestSignInLink(page, email);
  await expect(emailedLink(request, email)).resolves.toContain('/auth/confirm');
});
