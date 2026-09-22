import { expect, test, type Page } from '@playwright/test';
import {
  emailedLink,
  freshEmail,
  origin,
  resetRateLimits,
  signUpMember,
  uniqueName,
} from './support/accounts';

/**
 * Real Chromium virtual WebAuthn authenticators (CDP
 * `WebAuthn.addVirtualAuthenticator`) driving the actual passkey plugin
 * ceremonies over the production build (AUTH-5.1..5.6). Account setup uses
 * the real `/api/auth` and `/auth/confirm` handlers through `signUpMember`
 * (an isolated, labeled non-login helper: the subject under test here is
 * passkeys, sessions and email change, not the sign-up journey itself,
 * which `journey.e2e.ts` already proves).
 */
test.beforeEach(async ({ request }) => {
  await resetRateLimits(request);
});

async function addVirtualAuthenticator(page: Page) {
  const session = await page.context().newCDPSession(page);
  await session.send('WebAuthn.enable');
  const { authenticatorId } = await session.send(
    'WebAuthn.addVirtualAuthenticator',
    {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  return { session, authenticatorId };
}

test('a passkey saved during onboarding is usable to sign back in later', async ({
  page,
  request,
}) => {
  await addVirtualAuthenticator(page);
  await page.goto('/sign-in');
  const email = freshEmail();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page.getByRole('heading', { name: /check your inbox/i }),
  ).toBeVisible();
  await page.goto(await emailedLink(request, email));
  await page.getByRole('button', { name: 'Sign in to Daisy' }).click();

  await page.getByLabel('Username').fill(uniqueName('ada'));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page.getByRole('heading', { name: /next time, one tap/i }),
  ).toBeVisible();
  // Wait for the real ceremony's own response before the full-page
  // navigation that follows a successful save, so a slow verify never races
  // the client's own in-flight request.
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes('/passkey/verify-registration'),
    ),
    page.getByRole('button', { name: 'Save a passkey on this device' }).click(),
  ]);
  await expect(page).toHaveURL(/\/lobby$/);

  // The onboarding save used the real ceremony (not the stage-4 stub): the
  // account now owns exactly one passkey.
  await page.goto('/settings/security');
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(1);

  // A merely listed credential could still be unusable; prove it actually
  // authenticates by signing out and back in with it.
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForURL(/\/sign-in/);
  await page.goto('/sign-in?next=%2Flobby');
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page).toHaveURL(/\/lobby$/);
});

test('a passkey enrolled from settings can sign back in after signing out, and lands on the validated destination', async ({
  page,
}) => {
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

  await page.getByRole('button', { name: 'Remove' }).first().click();
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
});

test('removing the last passkey still leaves magic-link recovery working', async ({
  page,
  request,
}) => {
  await addVirtualAuthenticator(page);
  const { email } = await signUpMember(page.request);
  await page.goto('/settings/security');
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();

  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);

  // The button's own click handler navigates to /sign-in once sign-out
  // resolves; racing it with an explicit page.goto risks aborting whichever
  // navigation loses, so wait for it to land instead of re-navigating.
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForURL(/\/sign-in$/);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page.getByRole('heading', { name: /check your inbox/i }),
  ).toBeVisible();
  const link = await emailedLink(request, email);
  await page.goto(link);
  await page.getByRole('button', { name: 'Sign in to Daisy' }).click();
  await expect(page).toHaveURL(/\/lobby$/);
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
  await page.goto('/settings/security');
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(1);

  // A brand-new browser context with no authenticator at all stands in for
  // the replacement device the person now owns: the lost credential simply
  // is not there to offer, so the person falls back to the emailed link
  // without ever touching the passkey button.
  const lost = await browser.newContext({ ignoreHTTPSErrors: true });
  const lostPage = await lost.newPage();
  await lostPage.goto('/sign-in?next=%2Flobby');

  // Recovery: the verified email still reaches the account.
  await lostPage.getByLabel('Email').fill(email);
  await lostPage.getByRole('button', { name: 'Continue' }).click();
  await expect(
    lostPage.getByRole('heading', { name: /check your inbox/i }),
  ).toBeVisible();
  await lostPage.goto(await emailedLink(request, email));
  await lostPage.getByRole('button', { name: 'Sign in to Daisy' }).click();
  await expect(lostPage).toHaveURL(/\/lobby$/);

  // From the recovered session: remove the now-unreachable credential and
  // revoke every other session, including the original device's.
  await lostPage.goto('/settings/security');
  await lostPage.getByRole('button', { name: 'Remove' }).click();
  await expect(lostPage.getByRole('button', { name: 'Remove' })).toHaveCount(0);
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

test('sessions can be listed and another session revoked; the revoked cookie is refused next', async ({
  page,
  request,
  browser,
}) => {
  const { email } = await signUpMember(page.request);

  // A second, genuinely independent session for the same account, signed in
  // through the real UI in its own browser context.
  const other = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: origin,
  });
  const otherPage = await other.newPage();
  await otherPage.goto('/sign-in');
  await otherPage.getByLabel('Email').fill(email);
  await otherPage.getByRole('button', { name: 'Continue' }).click();
  await expect(
    otherPage.getByRole('heading', { name: /check your inbox/i }),
  ).toBeVisible();
  const link = await emailedLink(request, email);
  await otherPage.goto(link);
  await otherPage.getByRole('button', { name: 'Sign in to Daisy' }).click();
  await expect(otherPage).toHaveURL(/\/lobby$/);

  await page.goto('/settings/security');
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  await expect(page.getByText('This device')).toBeVisible();
  // One "Sign out" per other session row, plus the page's own sign-out
  // control; both happen to share the same label.
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toHaveCount(2);

  await page
    .getByRole('button', { name: 'Sign out of all other sessions' })
    .click();
  // The revocation reloads the list; wait for the other session's row (and
  // its "Sign out" button) to disappear before proving its cookie is
  // actually refused next.
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toHaveCount(1);
  await otherPage.goto('/lobby');
  await expect(otherPage).toHaveURL(/\/sign-in/);
  await other.close();
});

test('an email change is approved from the old inbox and verified at the new one', async ({
  page,
  request,
}) => {
  const { email } = await signUpMember(page.request);
  await page.goto('/settings/security');

  const newEmail = freshEmail();
  await page.getByLabel('New email address').fill(newEmail);
  await page.getByRole('button', { name: 'Change email' }).click();
  await expect(page.locator('#email-change-notice')).toContainText(
    /approve this change/i,
  );

  const approveLink = await emailedLink(request, email);
  await page.goto(approveLink);
  await page.getByRole('button', { name: 'Continue' }).click();

  const verifyLink = await emailedLink(request, newEmail);
  await page.goto(verifyLink);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/settings\/security$/);

  // The redirect alone doesn't prove the account now owns newEmail; prove
  // it by signing back in with a magic link sent to the new address.
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForURL(/\/sign-in/);
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(newEmail);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page.getByRole('heading', { name: /check your inbox/i }),
  ).toBeVisible();
  await page.goto(await emailedLink(request, newEmail));
  await page.getByRole('button', { name: 'Sign in to Daisy' }).click();
  await expect(page).toHaveURL(/\/lobby$/);
});

test('a conflicting email answers the same success shape, never disclosing the other account', async ({
  page,
}) => {
  const other = await signUpMember(page.request);
  await signUpMember(page.request); // the requester whose browser context we drive
  await page.goto('/settings/security');

  await page.getByLabel('New email address').fill(other.email);
  await page.getByRole('button', { name: 'Change email' }).click();
  await expect(page.locator('#email-change-notice')).toContainText(
    /approve this change/i,
  );
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
  await expect(
    page.getByRole('status').filter({ hasText: /cancelled/i }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in$/);

  const email = freshEmail();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page.getByRole('heading', { name: /check your inbox/i }),
  ).toBeVisible();
  await expect(emailedLink(request, email)).resolves.toContain('/auth/confirm');
});
