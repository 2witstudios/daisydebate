import { expect, test, type Page } from '@playwright/test';
import {
  emailedLink,
  freshEmail,
  resetRateLimits,
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

  // The passkey offer never claims a save it did not make.
  await expect(
    page.getByRole('heading', { name: /next time, one tap/i }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Save a passkey on this device' })
    .click();
  await expect(page.getByRole('status')).toContainText('nothing was saved');
  await page.getByRole('button', { name: 'Not now' }).click();

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
  await page.getByRole('button', { name: 'Not now' }).click();
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

test('a cancelled passkey ceremony shows no success and email sign-in still works', async ({
  page,
  request,
}) => {
  // A virtual authenticator with no credential: the browser has nothing to
  // offer, which is how a dismissed prompt or an unenrolled account looks.
  const session = await page.context().newCDPSession(page);
  await session.send('WebAuthn.enable');
  await session.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: /cancelled/i }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in$/);

  const email = freshEmail();
  await requestLink(page, email);
  await expect(emailedLink(request, email)).resolves.toContain('/auth/confirm');
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

test('the topbar offers sign-in to a visitor', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});
