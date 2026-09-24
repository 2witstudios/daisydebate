import { expect, test, type Page } from '@playwright/test';
import {
  emailedLink,
  freshEmail,
  resetRateLimits,
  signUpMember,
  signUpProvisional,
  uniqueName,
} from './support/accounts';

// The whole sign-in journey in a real browser against the production build:
// request a link on /sign-in, open the emailed link, get a session, pick a
// username, reach a protected page. Mail is captured off the wire by the e2e
// server; nothing is seeded and no session is pre-created.
test.beforeEach(async ({ request }) => {
  await resetRateLimits(request);
});

async function requestLink(page: Page, email: string) {
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page.getByRole('heading', { name: /check your inbox/i }),
  ).toBeVisible();
}

/** Opens the emailed link and takes the confirmation tap. */
async function confirm(page: Page, link: string) {
  await page.goto(link);
  await page.getByRole('button', { name: 'Sign in to Daisy' }).click();
}

const claimUsername = async (page: Page, name: string) => {
  await page.getByLabel('Username').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
};

test('anonymous visits are sent to sign-in and the whole loop ends on the protected page', async ({
  page,
  request,
}) => {
  await page.goto('/lobby');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Flobby$/);

  const email = freshEmail();
  await requestLink(page, email);
  const link = await emailedLink(request, email);
  await confirm(page, link);

  // A brand-new account is forced through username onboarding first.
  await expect(page).toHaveURL(/\/onboarding\/username\?next=(\/|%2F)lobby$/);
  await page.goto('/play');
  await expect(page).toHaveURL(/\/onboarding\/username\?next=%2Fplay$/);

  // Recoverable errors: invalid, then a name someone else already owns.
  const taken = uniqueName('taken');
  const other = await page
    .context()
    .browser()!
    .newContext({
      ignoreHTTPSErrors: true,
      baseURL: page.url().split('/onboarding')[0]!,
    });
  const otherPage = await other.newPage();
  const otherEmail = freshEmail();
  await otherPage.goto('/sign-in');
  await requestLink(otherPage, otherEmail);
  await confirm(otherPage, await emailedLink(request, otherEmail));
  await claimUsername(otherPage, taken);
  await expect(
    otherPage.getByRole('heading', { name: /next time, one tap/i }),
  ).toBeVisible();
  await other.close();

  await page.goto('/onboarding/username?next=%2Flobby');
  await claimUsername(page, 'no spaces allowed');
  await expect(page.locator('#username-notice')).toContainText(
    'That username will not work',
  );
  await claimUsername(page, taken.toUpperCase());
  await expect(page.locator('#username-notice')).toContainText('already taken');
  await expect(page.getByLabel('Username')).toHaveValue(taken.toUpperCase());

  const mine = uniqueName('ada');
  await claimUsername(page, mine.toUpperCase());

  // Declining the passkey offer (real enrollment is covered separately in
  // passkey-lifecycle.e2e.ts, with a virtual authenticator configured).
  await expect(
    page.getByRole('heading', { name: /next time, one tap/i }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Not now' }).click();

  // The safe return destination survived, and the username is the identity.
  await expect(page).toHaveURL(/\/lobby$/);
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
  await page.goto('/');
  await expect(
    page.getByRole('link', { name: `Account settings for ${mine}` }),
  ).toBeVisible();

  // The durable session and the persisted identity survive a reload and a
  // fresh request: the same account, with the username it claimed.
  await page.reload();
  await expect(
    page.getByRole('link', { name: `Account settings for ${mine}` }),
  ).toBeVisible();
  const session = await page.request.get('/api/auth/get-session');
  const body = (await session.json()) as {
    user: { email: string; username: string; emailVerified: boolean };
  };
  expect({
    email: body.user.email,
    username: body.user.username,
    verified: body.user.emailVerified,
  }).toEqual({ email, username: mine, verified: true });
});

test('a redeemed link cannot be replayed', async ({ page, request }) => {
  await page.goto('/sign-in');
  const email = freshEmail();
  await requestLink(page, email);
  const link = await emailedLink(request, email);
  await confirm(page, link);
  await expect(page).toHaveURL(/\/onboarding\/username/);

  await page.context().clearCookies();
  await confirm(page, link);
  await expect(
    page.getByRole('heading', { name: /can no longer be used/i }),
  ).toBeVisible();
  await page.goto('/lobby');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Flobby$/);
});

test('an interrupted signup resumes onboarding on the next sign-in', async ({
  page,
  request,
}) => {
  await page.goto('/sign-in?next=%2Franked');
  const email = freshEmail();
  await requestLink(page, email);
  await confirm(page, await emailedLink(request, email));
  await expect(page).toHaveURL(/\/onboarding\/username/);

  // Walk away without choosing a name, then sign in again later.
  await page.context().clearCookies();
  await resetRateLimits(request);
  await page.goto('/sign-in?next=%2Franked');
  await requestLink(page, email);
  const second = await emailedLink(request, email);
  expect(second).toBeTruthy();
  await page.goto(second);
  await page.getByRole('button', { name: 'Sign in to Daisy' }).click();
  await expect(page).toHaveURL(/\/onboarding\/username\?next=%2Franked$/);
  await page.goto('/ranked');
  await expect(page).toHaveURL(/\/onboarding\/username\?next=%2Franked$/);
});

test('return destinations are validated and spectator routes stay public', async ({
  page,
  request,
}) => {
  await page.goto('/watch');
  await expect(page).toHaveURL(/\/watch$/);

  await page.goto('/sign-in?next=%2F%2Fevil.example%2Fpath');
  const email = freshEmail();
  await requestLink(page, email);
  await confirm(page, await emailedLink(request, email));
  await expect(page).toHaveURL(/\/onboarding\/username\?next=(\/|%2F)lobby$/);
  await claimUsername(page, uniqueName('safe'));
  await page.getByRole('link', { name: 'Not now' }).click();
  await expect(page).toHaveURL(/\/lobby$/);
});

test('sign-in works by keyboard alone and every control has an accessible name', async ({
  page,
  request,
}) => {
  await page.goto('/sign-in');
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Sign in with a passkey' }),
  ).toBeVisible();

  const email = freshEmail();
  await page.getByLabel('Email').focus();
  await page.keyboard.type(email);
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: /check your inbox/i }),
  ).toBeVisible();
  await emailedLink(request, email);

  await page
    .getByRole('button', { name: /use a different email/i })
    .press('Enter');
  await expect(page.getByLabel('Email')).toBeVisible();
});

test('a browser without WebAuthn is told so and keeps the email path', async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'PublicKeyCredential');
  });
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: /cannot use passkeys/i }),
  ).toBeVisible();
  const email = freshEmail();
  await requestLink(page, email);
  await expect(emailedLink(request, email)).resolves.toContain('/auth/confirm');
});

test('an emailed link opened in a different browser than the one that requested it still signs in', async ({
  page,
  request,
  browser,
}) => {
  const email = freshEmail();
  await page.goto('/sign-in');
  await requestLink(page, email);
  const link = await emailedLink(request, email);

  // A genuinely separate browser context: no cookies, storage or history
  // shared with the requesting page (the "opened it on another device"
  // case a bearer magic link must support).
  const other = await browser.newContext({ ignoreHTTPSErrors: true });
  const otherPage = await other.newPage();
  await confirm(otherPage, link);
  await expect(otherPage).toHaveURL(/\/onboarding\/username/);
  await claimUsername(otherPage, uniqueName('cross-browser'));
  await expect(
    otherPage.getByRole('heading', { name: /next time, one tap/i }),
  ).toBeVisible();
  await otherPage.getByRole('link', { name: 'Not now' }).click();
  await expect(otherPage).toHaveURL(/\/lobby$/);

  // The requesting page never redeemed the link itself and stays anonymous.
  await page.goto('/lobby');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Flobby$/);
  await other.close();
});

test('refreshing or navigating back mid-onboarding does not lose the session or double-claim the username', async ({
  page,
  request,
}) => {
  const email = freshEmail();
  await page.goto('/sign-in');
  await requestLink(page, email);
  await confirm(page, await emailedLink(request, email));
  await expect(page).toHaveURL(/\/onboarding\/username/);

  // A reload mid-flow must not sign the person out or drop the destination.
  await page.reload();
  await expect(page).toHaveURL(/\/onboarding\/username/);

  const name = uniqueName('resumed');
  const offer = page.getByRole('heading', { name: /next time, one tap/i });
  await claimUsername(page, name);
  await expect(offer).toBeVisible();

  // The offer is its own page: a reload keeps it, and the session.
  await page.reload();
  await expect(offer).toBeVisible();

  // The claim never reopens for an account that has a username: the
  // server-rendered onboarding page sends it straight to its destination,
  // and going back from there returns to the offer, not to a claim form.
  await page.goto('/onboarding/username?next=%2Flobby');
  await expect(page).toHaveURL(/\/lobby$/);
  await page.goBack();
  await expect(offer).toBeVisible();

  const session = await page.request.get('/api/auth/get-session');
  const body = (await session.json()) as { user: { username: string } };
  expect(body.user.username).toBe(name);
});

test('a fresh session makes no refresh call, and neither does a visitor', async ({
  page,
}) => {
  const calls: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/auth/get-session')
      calls.push(request.url());
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await signUpMember(page.request);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.goto('/lobby');
  await page.waitForLoadState('networkidle');
  // A refresh is due only a day after the last extension, so a browser
  // spends the rate-limited endpoint about once a day, not per page load.
  expect(calls).toEqual([]);
});

/**
 * Every mutating form works with JavaScript off (docs/development/
 * ui-conventions.md). These contexts run no script at all, inline or
 * bundled, so a page that only script can reveal, or a form that only
 * script can submit, fails here.
 */
test.describe('with JavaScript off', () => {
  test.use({ javaScriptEnabled: false });

  /** Form values must never reach the address bar, history or referrers. */
  const expectNotInUrl = (page: Page, value: string) => {
    expect(page.url()).not.toContain(value);
    expect(page.url()).not.toContain(encodeURIComponent(value));
  };

  test('sign-in emails a link through a POST and shows the inbox step', async ({
    page,
    request,
  }) => {
    const email = freshEmail();
    await page.goto('/sign-in?next=%2Flobby');
    await requestLink(page, email);
    await expect(page.getByText(email)).toBeVisible();
    expectNotInUrl(page, email);

    // The emailed link is real: it finishes sign-in on this browser, still
    // with no script, and a new account goes on to onboarding.
    await confirm(page, await emailedLink(request, email));
    await expect(page).toHaveURL(/\/onboarding\/username\?next=(\/|%2F)lobby$/);
  });

  test('the username form renders, refuses and claims', async ({ page }) => {
    await signUpProvisional(page.request);
    await page.goto('/onboarding/username?next=%2Flobby');

    // A refusal comes back from the server with the name as typed.
    await claimUsername(page, 'no spaces allowed');
    await expect(page.locator('#username-notice')).toContainText(
      'That username will not work',
    );
    await expect(page.getByLabel('Username')).toHaveValue('no spaces allowed');
    expectNotInUrl(page, 'no spaces allowed');

    const name = uniqueName('noscript');
    await claimUsername(page, name);
    await expect(
      page.getByRole('heading', { name: /next time, one tap/i }),
    ).toBeVisible();
    expectNotInUrl(page, name);
    await page.getByRole('link', { name: 'Not now' }).click();
    await expect(page).toHaveURL(/\/lobby$/);
    await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();

    const session = await page.request.get('/api/auth/get-session');
    const body = (await session.json()) as { user: { username: string } };
    expect(body.user.username).toBe(name);
  });

  test('an email change starts through a POST and mails the address on file', async ({
    page,
    request,
  }) => {
    const { email } = await signUpMember(page.request);
    await page.goto('/settings/security');
    const next = freshEmail();
    await page.getByLabel('New email address').fill(next);
    await page.getByRole('button', { name: 'Change email' }).click();
    await expect(page.locator('#email-change-notice')).toContainText(
      /approve this change/i,
    );
    expectNotInUrl(page, next);
    // The approval goes to the address on file, never the new one.
    expect(await emailedLink(request, email)).toContain('/auth/confirm-email');
  });
});

test('the topbar offers sign-in to a visitor', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});
