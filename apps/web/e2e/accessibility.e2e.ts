import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
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

/**
 * Automated accessibility coverage for every authentication and security
 * screen (AUTH-6.6), plus the signed-in product shell's home and settings
 * routes in both themes (ISSUE-10): zero serious/critical axe findings,
 * keyboard-only use, visible focus, live-region announcements and usability
 * at 200% zoom. Chromium/Firefox/WebKit desktop and mobile projects all run
 * this file (only passkey-lifecycle.e2e.ts is Chromium-only), so narrow
 * (compact) layout usability is exercised by the mobile projects without a
 * separate test; only the theme axis needs its own explicit cases here.
 */
test.beforeEach(async ({ request }) => {
  await resetRateLimits(request);
});

/** Fails on any serious/critical finding; moderate/minor are not gating. */
async function assertNoSeriousFindings(page: Page) {
  // Contrast checks read real computed/rendered colors; scanning before the
  // brand webfont finishes swapping in can catch a mid-swap paint and
  // misreport a transient color, so wait for fonts to settle first.
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) =>
      violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

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

test('an expired confirmation link has no serious or critical accessibility findings', async ({
  page,
  request,
}) => {
  const email = freshEmail();
  await page.goto('/sign-in');
  await requestSignInLink(page, email);
  const link = await emailedLink(request, email);
  await confirmSignIn(page, link);
  await page.context().clearCookies();
  // A redeemed link revisited looks the same as an expired one to the user.
  await page.goto(link);
  await page.getByRole('button', { name: 'Sign in to Daisy' }).click();
  await expect(
    page.getByRole('heading', { name: /can no longer be used/i }),
  ).toBeVisible();
  await assertNoSeriousFindings(page);
});

test('username onboarding is fully usable by keyboard alone, with visible focus', async ({
  page,
  request,
  browserName,
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
  // Reach "Not now" by tabbing forward through whatever comes before it,
  // proving it is keyboard-reachable without hard-coding a specific tab
  // index. It is a link, and WebKit (like Safari) moves focus to links with
  // Option+Tab rather than Tab.
  const tabKey = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  const notNow = page.getByRole('link', { name: 'Not now' });
  for (
    let tab = 0;
    tab < 10 && !(await notNow.evaluate((el) => el === document.activeElement));
    tab += 1
  )
    await page.keyboard.press(tabKey);
  await expect(notNow).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/lobby$/);
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
  await page.getByLabel('New email address').fill(freshEmail());
  await page.getByRole('button', { name: 'Change email' }).click();
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
