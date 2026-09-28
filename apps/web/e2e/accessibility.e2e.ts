import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  emailedLink,
  freshEmail,
  resetRateLimits,
  signUpMember,
  uniqueName,
  confirmSignIn,
  reachOnboarding,
  requestSignInLink,
} from './support/accounts';
import { assertNoSeriousFindings } from './support/axe';
import { changeEmail, declineByKeyboard } from './support/forms';

/**
 * Automated accessibility coverage for every authentication and security
 * screen (AUTH-6.6), the passkey offer in both themes (ISSUE-77), plus the
 * signed-in product shell's home and settings routes in both themes
 * (ISSUE-10): zero serious/critical axe findings,
 * keyboard-only use, visible focus, live-region announcements and usability
 * at 200% zoom. Chromium/Firefox/WebKit desktop and mobile projects all run
 * this file (only passkey-lifecycle.e2e.ts is Chromium-only), so narrow
 * (compact) layout usability is exercised by the mobile projects without a
 * separate test; only the theme axis needs its own explicit cases here.
 */
test.beforeEach(async ({ request }) => {
  await resetRateLimits(request);
});

/**
 * Navigates with the theme cookie already set, so the server renders the
 * requested `data-theme` from the first response (no flash, no client
 * switch to wait on).
 */
async function gotoWithTheme(
  page: Page,
  path: string,
  theme: 'light' | 'dark',
) {
  await page.goto(path);
  await page.context().addCookies([
    {
      name: 'daisy-theme',
      value: theme,
      url: new URL(page.url()).origin,
    },
  ]);
  await page.goto(path);
}

test('sign-in (idle state) has no serious or critical accessibility findings', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await assertNoSeriousFindings(page);
});

test('sign-in (pending confirmation state) has no serious or critical accessibility findings', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await requestSignInLink(page, freshEmail());
  await assertNoSeriousFindings(page);
});

test('username onboarding has no serious or critical accessibility findings', async ({
  page,
  request,
}) => {
  await reachOnboarding(page, request);
  await assertNoSeriousFindings(page);

  // A recoverable validation error is also part of this screen's contract.
  await page.getByLabel('Username').fill('no spaces allowed');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#username-notice')).toBeVisible();
  await assertNoSeriousFindings(page);
});

test('account security settings has no serious or critical accessibility findings', async ({
  page,
}) => {
  await signUpMember(page.request);
  await page.goto('/settings/security');
  await assertNoSeriousFindings(page);
});

/**
 * A redeemed link revisited looks the same as an expired one to the user
 * (AUTH-4.7's expired state): sign up, redeem, clear the session, then
 * revisit and take the confirmation tap again.
 */
async function reachExpiredLink(
  page: Page,
  request: APIRequestContext,
): Promise<string> {
  const email = freshEmail();
  await page.goto('/sign-in');
  await requestSignInLink(page, email);
  const link = await emailedLink(request, email);
  await confirmSignIn(page, link);
  await page.context().clearCookies();
  await page.goto(link);
  await page.getByRole('button', { name: 'Sign in to Daisy' }).click();
  await expect(
    page.getByRole('heading', { name: /can no longer be used/i }),
  ).toBeVisible();
  return email;
}

test('an expired confirmation link has no serious or critical accessibility findings', async ({
  page,
  request,
}) => {
  await reachExpiredLink(page, request);
  await assertNoSeriousFindings(page);
});

test('username onboarding is fully usable by keyboard alone, with visible focus', async ({
  page,
  request,
}) => {
  await reachOnboarding(page, request);

  // The shell streams in behind the root loading boundary and is revealed
  // a moment later; focus the field only once it is the visible one.
  await expect(page.getByLabel('Username')).toBeVisible();
  await page.getByLabel('Username').focus();
  await expect(page.getByLabel('Username')).toBeFocused();
  await page.keyboard.type(uniqueName('kbd'));
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: /next time, one tap/i }),
  ).toBeVisible();
  // ISSUE-75: both decline choices are real buttons, so plain Tab reaches
  // them in every engine (WebKit used to skip links on Tab, needing
  // Option+Tab).
  await declineByKeyboard(page, 'Not now');
});

test('the shared-computer decline choice is reachable with plain Tab in every engine', async ({
  page,
  request,
}) => {
  await reachOnboarding(page, request);
  await expect(page.getByLabel('Username')).toBeVisible();
  await page.getByLabel('Username').focus();
  await page.keyboard.type(uniqueName('kbd2'));
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: /next time, one tap/i }),
  ).toBeVisible();
  await declineByKeyboard(page, 'This is a shared computer');
});

test('account security settings is operable by keyboard alone', async ({
  page,
}) => {
  await signUpMember(page.request);
  await page.goto('/settings/security');

  const newEmail = freshEmail();
  // ISSUE-45: the settings page streams in behind the root loading boundary
  // and React reveals it a moment later; a focus sent before that lands on
  // the still-hidden copy and is lost. Focus the field once it is visible.
  await expect(page.getByLabel('New email address')).toBeVisible();
  await page.getByLabel('New email address').focus();
  await expect(page.getByLabel('New email address')).toBeFocused();
  await page.keyboard.type(newEmail);
  await page.keyboard.press('Enter');
  await expect(page.locator('#email-change-notice')).toContainText(
    /approve this change/i,
  );
});

test('feedback regions announce updates through an accessible live region', async ({
  page,
}) => {
  await signUpMember(page.request);
  await page.goto('/settings/security');
  await changeEmail(page, freshEmail());
  const notice = page.locator('#email-change-notice');
  await expect(notice).toContainText(/approve this change/i);
  // `role="status"` implies an accessible-name-only live region announcement
  // (aria-live: polite) without a redundant explicit attribute.
  await expect(notice).toHaveAttribute('role', 'status');
});

test('sign-in stays usable with no horizontal overflow at 200% effective zoom', async ({
  page,
}) => {
  // Playwright has no native browser-zoom control; halving the viewport
  // while keeping the same page content approximates a 200% zoom reflow
  // (twice as many CSS pixels per visible inch), the standard technique for
  // testing zoom-driven reflow without a real browser UI.
  await page.setViewportSize({ width: 640, height: 400 });
  await page.goto('/sign-in');
  const overflowsHorizontally = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
  );
  expect(overflowsHorizontally).toBe(false);
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
});

test('account security settings stays usable with no horizontal overflow at 200% effective zoom', async ({
  page,
}) => {
  await signUpMember(page.request);
  await page.setViewportSize({ width: 640, height: 400 });
  await page.goto('/settings/security');
  const overflowsHorizontally = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
  );
  expect(overflowsHorizontally).toBe(false);
  await expect(page.getByRole('heading', { name: 'Passkeys' })).toBeVisible();
});

test('home has no serious or critical accessibility findings in dark or light', async ({
  page,
}) => {
  await gotoWithTheme(page, '/', 'dark');
  await assertNoSeriousFindings(page);

  await gotoWithTheme(page, '/', 'light');
  await assertNoSeriousFindings(page);
});

test('settings has no serious or critical accessibility findings in dark or light', async ({
  page,
}) => {
  await signUpMember(page.request);

  await gotoWithTheme(page, '/settings', 'dark');
  await assertNoSeriousFindings(page);

  await gotoWithTheme(page, '/settings', 'light');
  await assertNoSeriousFindings(page);
});

test('the confirm sign-in page (AUTH-4.7) has no serious or critical accessibility findings in dark or light', async ({
  page,
  request,
}) => {
  const email = freshEmail();
  await page.goto('/sign-in');
  await requestSignInLink(page, email);
  const link = await emailedLink(request, email);

  await gotoWithTheme(page, link, 'dark');
  await expect(
    page.getByRole('button', { name: 'Sign in to Daisy' }),
  ).toBeVisible();
  await assertNoSeriousFindings(page);

  await gotoWithTheme(page, link, 'light');
  await assertNoSeriousFindings(page);
});

test('the expired-link resend state has no serious or critical accessibility findings, and lands on "check your inbox"', async ({
  page,
  request,
}) => {
  const email = await reachExpiredLink(page, request);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a new link' }).click();
  await expect(
    page.getByRole('heading', { name: /check your inbox/i }),
  ).toBeVisible();
  await assertNoSeriousFindings(page);
});

test('the confirm sign-in page stays usable with no horizontal overflow at 320 px and 200% effective zoom', async ({
  page,
  request,
}) => {
  const email = freshEmail();
  await page.goto('/sign-in');
  await requestSignInLink(page, email);
  const link = await emailedLink(request, email);

  for (const width of [320, 640]) {
    await page.setViewportSize({ width, height: 480 });
    await page.goto(link);
    const overflowsHorizontally = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    );
    expect(overflowsHorizontally).toBe(false);
    await expect(
      page.getByRole('button', { name: 'Sign in to Daisy' }),
    ).toBeVisible();
  }
});

test('the passkey offer has no serious or critical accessibility findings in dark or light', async ({
  page,
}) => {
  await signUpMember(page.request);

  await gotoWithTheme(page, '/onboarding/passkey?next=%2Flobby', 'dark');
  await expect(
    page.getByRole('heading', { name: /next time, one tap/i }),
  ).toBeVisible();
  await assertNoSeriousFindings(page);

  await gotoWithTheme(page, '/onboarding/passkey?next=%2Flobby', 'light');
  await assertNoSeriousFindings(page);
});
