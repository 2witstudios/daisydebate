import { approveBetaAccounts } from './support/beta-access';
import { expect, test } from './support/fixtures';
import {
  confirmSignIn,
  emailedLink,
  freshEmail,
  origin,
  requestSignInLink,
  resetRateLimits,
  signUpMember,
  signUpProvisional,
  uniqueName,
  answerAgeStep,
  signUpBeforeAge,
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
  const { email } = await signUpProvisional(page.request);
  await page.goto('/onboarding/username?next=%2Flobby');
  await effectsRan(page);
  await claimUsername(page, uniqueName('walker'));
  // Approved by an operator (ADR 0075), so the finished member reaches /lobby.
  await approveBetaAccounts(email);
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

test('a member who follows a link from another site to any onboarding step gets the step, not an error', async ({
  page,
}) => {
  await signUpMember(page.request);
  // A top-level navigation from another site carries these headers; the
  // page render must not run an API's cross-site read check on them.
  for (const step of ['welcome', 'about', 'ready', 'passkey'] as const) {
    const response = await page.request.get(
      `/onboarding/${step}?next=%2Flobby`,
      {
        headers: {
          'sec-fetch-site': 'cross-site',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'document',
        },
        maxRedirects: 0,
      },
    );
    expect(response.status(), step).toBe(200);
  }
});

test('a visitor who signs up from the Help link goes through onboarding once and lands on the lobby', async ({
  page,
  request,
}) => {
  await page.goto('/onboarding/welcome');
  // Sign-in returns to the welcome step with its own validated next.
  await expect(page).toHaveURL(
    /\/sign-in\?next=%2Fonboarding%2Fwelcome%3Fnext%3D%252Flobby$/,
  );
  const email = freshEmail();
  await requestSignInLink(page, email);
  await confirmSignIn(page, await emailedLink(request, email));
  await answerAgeStep(page);
  await claimUsername(page, uniqueName('helper'));
  // Approved by an operator (ADR 0075); beta.e2e.ts proves the wait itself.
  await approveBetaAccounts(email);
  await page.getByRole('button', { name: 'Not now' }).click();
  // The destination is already the welcome step: no onboarding inside it.
  await expect(page).toHaveURL(/\/onboarding\/welcome\?next=(\/|%2F)lobby$/);
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page).toHaveURL(/\/onboarding\/ready\?next=(\/|%2F)lobby$/);
  await page.getByRole('link', { name: 'Go to home' }).click();
  await expect(page).toHaveURL(/\/lobby$/);
});

// The age step (WAIT-4.6, WAIT-4.7): an answer below the beta floor keeps
// nothing, signs the browser out with the account gone, and holds the
// browser to the same neutral page for a day.
for (const [label, year, title] of [
  ['under 13', 2018, 'Daisy is for people 13 and older.'],
  [
    '13 to 15, during the beta',
    2012,
    'The Daisy beta is open to people 16 and older for now.',
  ],
] as const)
  test(`an age ${label} is refused, kept nowhere and held`, async ({
    page,
  }) => {
    await signUpBeforeAge(page.request);
    await page.goto('/onboarding/age?next=%2Flobby');
    await page.getByLabel('Month').selectOption('6');
    await page.getByLabel('Year').selectOption(String(year));
    await page.getByLabel(/I agree to the Terms/).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(
      page.getByText('We haven’t kept anything you entered.'),
    ).toBeVisible();
    await expect(page.getByRole('combobox')).toHaveCount(0);
    // The account is gone: its session no longer signs anyone in.
    const session = await page.request.get('/api/auth/get-session');
    expect(await session.json()).toBeNull();
    // The browser is held to the same answer.
    await page.goto('/onboarding/age?next=%2Flobby');
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  });

test.describe('the age step with JavaScript off', () => {
  test.use({ javaScriptEnabled: false });

  test('a native post leads to the username', async ({ page }) => {
    await signUpBeforeAge(page.request);
    await page.goto('/onboarding/age?next=%2Flobby');
    await page.getByRole('button', { name: 'Continue' }).click();
    // Native validation keeps an unanswered form from posting.
    await expect(page).toHaveURL(/\/onboarding\/age/);
    await answerAgeStep(page);
    await expect(page).toHaveURL(/\/onboarding\/username\?next=(\/|%2F)lobby$/);
  });
});

test.describe('onboarding answers in Settings without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  // ISSUE-324: a member sees what they answered and can change it.
  test('Settings lists the answers; Edit opens the step, and saving returns to Settings through the Ready step', async ({
    page,
  }) => {
    await signUpMember(page.request);
    const saved = await page.request.post('/api/account/onboarding', {
      headers: { origin },
      data: { step: 'topics', topics: ['law'] },
    });
    expect(saved.status()).toBe(200);

    await page.goto('/settings');
    await expect(page.getByText('Your onboarding answers')).toBeVisible();
    await expect(page.getByText('Law', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Edit topics' }).click();
    await expect(page).toHaveURL(/\/onboarding\/topics\?next=%2Fsettings$/);
    // Saving the step goes on through the Ready step, which leads back to Settings.
    await page.locator('label', { hasText: 'Economics' }).click();
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page).toHaveURL(/\/onboarding\/ready\?next=%2Fsettings$/);
    await page.getByRole('link', { name: 'Go to home' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    const topics = page
      .getByRole('definition')
      .filter({ has: page.getByRole('link', { name: 'Edit topics' }) });
    await expect(topics).toContainText('Economics');
    await expect(topics).toContainText('Law');
  });
});
