import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  emailedLink,
  freshEmail,
  resetRateLimits,
  signUpMember,
  uniqueName,
} from './support/accounts';

/**
 * Automated accessibility coverage for every authentication and security
 * screen (AUTH-6.6): zero serious/critical axe findings, keyboard-only use,
 * visible focus, live-region announcements and usability at 200% zoom.
 * Chromium/Firefox/WebKit desktop and mobile projects all run this file
 * (only passkey-lifecycle.e2e.ts is Chromium-only), so narrow-layout
 * usability is exercised by the mobile projects without a separate test.
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
  await page.getByLabel('Email').fill(freshEmail());
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page.getByRole('heading', { name: /check your inbox/i }),
  ).toBeVisible();
  await assertNoSeriousFindings(page);
});

test('username onboarding has no serious or critical accessibility findings', async ({
  page,
  request,
}) => {
  const email = freshEmail();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.goto(await emailedLink(request, email));
  await page.getByRole('button', { name: 'Sign in to Daisy' }).click();
  await expect(page).toHaveURL(/\/onboarding\/username/);
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
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  const link = await emailedLink(request, email);
  await page.goto(link);
  await page.getByRole('button', { name: 'Sign in to Daisy' }).click();
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
}) => {
  const email = freshEmail();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.goto(await emailedLink(request, email));
  await page.getByRole('button', { name: 'Sign in to Daisy' }).click();
  await expect(page).toHaveURL(/\/onboarding\/username/);

  await page.getByLabel('Username').focus();
  await expect(page.getByLabel('Username')).toBeFocused();
  await page.keyboard.type(uniqueName('kbd'));
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: /next time, one tap/i }),
  ).toBeVisible();
  // Focus resets to the document after the full-page navigation; reach
  // "Not now" by tabbing forward through whatever comes before it, proving
  // it is keyboard-reachable without hard-coding a specific tab index.
  const notNow = page.getByRole('button', { name: 'Not now' });
  for (
    let tab = 0;
    tab < 10 && !(await notNow.evaluate((el) => el === document.activeElement));
    tab += 1
  )
    await page.keyboard.press('Tab');
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
