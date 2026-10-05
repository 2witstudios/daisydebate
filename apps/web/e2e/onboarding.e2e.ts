import { expect, test } from './support/fixtures';
import {
  origin,
  resetRateLimits,
  signUpMember,
  signUpProvisional,
  uniqueName,
} from './support/accounts';
import { claimUsername } from './support/forms';
import { effectsRan } from './support/hydration';
import { walkOnboarding } from './support/onboarding';

// The username step with JavaScript on: what the hydrated page adds to the
// form's POST. The same step with JavaScript off is proven in
// journey.e2e.ts.
test.beforeEach(async ({ request }) => {
  await resetRateLimits(request);
});

test('a claim made with JavaScript moves on without the server fetching the next page', async ({
  page,
}) => {
  await signUpProvisional(page.request);
  await page.goto('/onboarding/username?next=%2Flobby');
  await effectsRan(page);
  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.request().headers()['next-action'] !== undefined,
  );
  await claimUsername(page, uniqueName('scripted'));
  // A redirect() here makes Next fetch the next page from the public origin
  // with the browser's cookies (ISSUE-80); it announces it with this header.
  expect((await answered).headers()['x-action-redirect']).toBeUndefined();
  await expect(
    page.getByRole('heading', { name: /next time, one tap/i }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding\/passkey\?next=(\/|%2F)lobby$/);
});

test('a new claim hides the last refusal while it is pending', async ({
  page,
  playwright,
}) => {
  const other = await playwright.request.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  const { username: taken } = await signUpMember(other);
  await other.dispose();
  await signUpProvisional(page.request);
  await page.goto('/onboarding/username?next=%2Flobby');
  await effectsRan(page);
  await claimUsername(page, taken);
  const notice = page.locator('#username-notice');
  await expect(notice).toContainText('already taken');

  // Hold the next claim's POST until the pending screen has been checked:
  // nothing waits on a timer.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/onboarding/username**', async (route) => {
    if (route.request().method() === 'POST') await held;
    await route.continue();
  });
  await claimUsername(page, uniqueName('pending'));
  await expect(page.getByRole('button', { name: /saving/i })).toBeVisible();
  await expect(page.getByText(/already taken/)).toHaveCount(0);
  await expect(page.getByLabel('Username')).not.toHaveAttribute(
    'aria-invalid',
    'true',
  );
  release();
  await expect(
    page.getByRole('heading', { name: /next time, one tap/i }),
  ).toBeVisible();
});

test('a new member walks onboarding with JavaScript and the answers stay saved', async ({
  page,
}) => {
  await signUpProvisional(page.request);
  await page.goto('/onboarding/username?next=%2Flobby');
  await effectsRan(page);
  await claimUsername(page, uniqueName('walker'));
  await page.getByRole('button', { name: 'Not now' }).click();
  await walkOnboarding(page);

  // Edit reopens a step with the saved answers ticked.
  await page.getByRole('link', { name: 'Edit topics' }).click();
  await expect(page.getByRole('checkbox', { name: 'Law' })).toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: 'Politics' }),
  ).not.toBeChecked();

  // A member who finished goes straight on after the passkey offer.
  await page.goto('/onboarding/passkey?next=%2Flobby');
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page).toHaveURL(/\/lobby$/);
});

test('Skip finishes onboarding from any step and lands on the last step', async ({
  page,
}) => {
  await signUpMember(page.request);
  await page.goto('/onboarding/daisy?next=%2Franked');
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page).toHaveURL(/\/onboarding\/ready\?next=(\/|%2F)ranked$/);
  await page.getByRole('link', { name: 'Go to home' }).click();
  await expect(page).toHaveURL(/\/ranked$/);
});
