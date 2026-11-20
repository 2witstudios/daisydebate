import type { APIRequestContext, Page } from '@playwright/test';
import { approveBetaAccounts } from './support/beta-access';
import { expect, openPage, test } from './support/fixtures';
import {
  emailedLink,
  freshEmail,
  confirmSignIn,
  requestSignInLink,
  resetRateLimits,
  signUpMember,
  uniqueName,
  reachOnboarding,
  reachOnboardingFromRanked,
  sessionUsername,
  answerAgeStep,
  origin,
} from './support/accounts';
import { requestConfirmLink } from './support/confirm-page';
import {
  claimUsername,
  declineOfferToLobby,
  skipOnboarding,
} from './support/forms';
import { effectsRan } from './support/hydration';
import { onPhone, profileLink, watchShellLinks } from './support/shell-links';

// The whole sign-in journey in a real browser against the production build:
// request a link on /sign-in, open the emailed link, get a session, pick a
// username, reach a protected page. Mail is captured off the wire by the e2e
// server; nothing is seeded and no session is pre-created.
/** A brand-new account signed in from its emailed link and past the age step. */
const signUpPastAge = async (page: Page, request: APIRequestContext) => {
  const email = freshEmail();
  await requestSignInLink(page, email);
  const link = await emailedLink(request, email);
  await confirmSignIn(page, link);
  await answerAgeStep(page);
  return { email, link };
};

test.beforeEach(async ({ request }) => {
  await resetRateLimits(request);
});

test('anonymous visits are sent to sign-in and the whole loop ends on the protected page', async ({
  page,
  request,
}) => {
  await page.goto('/lobby');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Flobby$/);

  const { email } = await signUpPastAge(page, request);

  // A brand-new account is forced through username onboarding first.
  await expect(page).toHaveURL(/\/onboarding\/username\?next=(\/|%2F)lobby$/);
  await page.goto('/play');
  await expect(page).toHaveURL(/\/onboarding\/username\?next=%2Fplay$/);

  // Recoverable errors: invalid, then a name someone else already owns.
  // The other account only has to own a name, so it signs up through the
  // real handlers without a second page: this page's own loop already walks
  // the UI, and repeating it cost a third of the test on a loaded machine
  // (ISSUE-204).
  const other = await page
    .context()
    .browser()!
    .newContext({
      ignoreHTTPSErrors: true,
      baseURL: page.url().split('/onboarding')[0]!,
    });
  const { username: taken } = await signUpMember(other.request);
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
  // The account waits on the beta list until an operator approves it
  // (ADR 0075); beta.e2e.ts proves the wait itself.
  await approveBetaAccounts(email);

  // Declining the passkey offer (real enrollment is covered separately in
  // passkey-lifecycle.e2e.ts, with a virtual authenticator configured).
  await expect(
    page.getByRole('heading', { name: /next time, one tap/i }),
  ).toBeVisible();
  // The safe return destination survived, and the username is the identity.
  await declineOfferToLobby(page);
  await page.goto('/');
  const own = await profileLink(page, mine);
  await expect(own).toBeVisible();
  await expect(own).toHaveAttribute('href', `/profile/${mine}`);

  // The durable session and the persisted identity survive a reload and a
  // fresh request: the same account, with the username it claimed.
  await page.reload();
  const reloaded = await profileLink(page, mine);
  await expect(reloaded).toBeVisible();
  await expect(reloaded).toHaveAttribute('href', `/profile/${mine}`);
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
  const { link } = await signUpPastAge(page, request);
  await expect(page).toHaveURL(/\/onboarding\/username/);

  await page.context().clearCookies();
  await confirmSignIn(page, link);
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
  await requestSignInLink(page, email);
  await confirmSignIn(page, await emailedLink(request, email));
  await answerAgeStep(page);
  await expect(page).toHaveURL(/\/onboarding\/username/);

  // Walk away without choosing a name, then sign in again later.
  await page.context().clearCookies();
  await resetRateLimits(request);
  await page.goto('/sign-in?next=%2Franked');
  await requestSignInLink(page, email);
  const second = await emailedLink(request, email);
  expect(second).toBeTruthy();
  await page.goto(second);
  await page.getByRole('button', { name: 'Sign in to Daisy Debate' }).click();
  await expect(page).toHaveURL(/\/onboarding\/username\?next=%2Franked$/);
  await page.goto('/ranked');
  await expect(page).toHaveURL(/\/onboarding\/username\?next=%2Franked$/);
});

test('declining the passkey offer after onboarding from a protected page other than /lobby returns there (AUTH-4.3-AC3, ISSUE-159)', async ({
  page,
  request,
}) => {
  const email = await reachOnboardingFromRanked(page, request);
  await claimUsername(page, uniqueName('ranked'));
  // Approved by an operator (ADR 0075); beta.e2e.ts proves the wait itself.
  await approveBetaAccounts(email);
  await expect(
    page.getByRole('heading', { name: /next time, one tap/i }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Not now' }).click();
  await skipOnboarding(page, /\/ranked$/);
});

test('return destinations are validated and public routes stay public', async ({
  page,
  request,
}) => {
  await page.goto('/leaderboard');
  await expect(page).toHaveURL(/\/leaderboard$/);

  await page.goto('/sign-in?next=%2F%2Fevil.example%2Fpath');
  const email = freshEmail();
  await requestSignInLink(page, email);
  await confirmSignIn(page, await emailedLink(request, email));
  await answerAgeStep(page);
  await expect(page).toHaveURL(/\/onboarding\/username\?next=(\/|%2F)lobby$/);
  await claimUsername(page, uniqueName('safe'));
  // Approved by an operator (ADR 0075); beta.e2e.ts proves the wait itself.
  await approveBetaAccounts(email);
  await page.getByRole('button', { name: 'Not now' }).click();
  await skipOnboarding(page, /\/lobby$/);
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
  await expect(page.getByLabel('Email')).toBeVisible();
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
  await requestSignInLink(page, email);
  await expect(emailedLink(request, email)).resolves.toContain('/auth/confirm');
});

test('an emailed link opened in a different browser than the one that requested it still signs in', async ({
  page,
  request,
  browser,
}) => {
  const email = freshEmail();
  await page.goto('/sign-in');
  await requestSignInLink(page, email);
  const link = await emailedLink(request, email);

  // A genuinely separate browser context: no cookies, storage or history
  // shared with the requesting page (the "opened it on another device"
  // case a bearer magic link must support).
  const other = await browser.newContext({ ignoreHTTPSErrors: true });
  const otherPage = await openPage(other, 'the other browser');
  await confirmSignIn(otherPage, link);
  await answerAgeStep(otherPage);
  await expect(otherPage).toHaveURL(/\/onboarding\/username/);
  await claimUsername(otherPage, uniqueName('cross-browser'));
  // Approved by an operator (ADR 0075); beta.e2e.ts proves the wait itself.
  await approveBetaAccounts(email);
  await expect(
    otherPage.getByRole('heading', { name: /next time, one tap/i }),
  ).toBeVisible();
  await otherPage.getByRole('button', { name: 'Not now' }).click();
  await skipOnboarding(otherPage, /\/lobby$/);

  // The requesting page never redeemed the link itself and stays anonymous.
  await page.goto('/lobby');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Flobby$/);
  await other.close();
});

test('refreshing or navigating back mid-onboarding does not lose the session or double-claim the username', async ({
  page,
  request,
}) => {
  const email = await reachOnboarding(page, request);

  // A reload mid-flow must not sign the person out or drop the destination.
  await page.reload();
  await expect(page).toHaveURL(/\/onboarding\/username/);

  const name = uniqueName('resumed');
  const offer = page.getByRole('heading', { name: /next time, one tap/i });
  await claimUsername(page, name);
  // Approved by an operator (ADR 0075); beta.e2e.ts proves the wait itself.
  await approveBetaAccounts(email);
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

  expect(await sessionUsername(page)).toBe(name);
});

test('a fresh session makes no refresh call, and neither does a visitor', async ({
  page,
}) => {
  const calls: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/auth/get-session')
      calls.push(request.url());
  });
  // A refresh is made from a mount effect, so each page is checked once its
  // effects have run, not once the network (avatars included) goes idle.
  await page.goto('/');
  await effectsRan(page);
  await signUpMember(page.request);
  await page.goto('/');
  await effectsRan(page);
  await page.goto('/lobby');
  await effectsRan(page);
  // A refresh is due only a day after the last extension, so a browser
  // spends the rate-limited endpoint about once a day, not per page load.
  expect(calls).toEqual([]);
});

test('a visitor can reach home, and Sign in at the rail foot or in the bottom tabs', async ({
  page,
}) => {
  // The rail leads with the logo; the phone's bottom tabs with Home.
  const phone = onPhone(page);
  const home = phone ? 'Home' : 'Daisy Debate home';
  const shell = await watchShellLinks(page, [home, 'Sign in']);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  const signIn = nav.getByRole('link', { name: 'Sign in' });
  await expect(signIn).toBeVisible();
  // Where the visitor's way in sits: the foot of the rail, below the links;
  // on a phone, a bottom tab, on Home's line.
  const [start, way] = await Promise.all([
    nav.getByRole('link', { name: home, exact: true }).boundingBox(),
    signIn.boundingBox(),
  ]);
  expect(
    start !== null &&
      way !== null &&
      (phone
        ? Math.abs(way.y - start.y) < 2 && way.x > start.x
        : way.y > start.y && way.x < 56),
  ).toBe(true);
  const { covered, inspected } = await shell.settle();
  expect(Object.keys(inspected).sort()).toEqual([home, 'Sign in'].sort());
  expect(covered).toEqual([]);
  await signIn.click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('AUTH-4.7: a real double submit of the same confirm link ends on a usable page', async ({
  page,
  request,
}) => {
  const { link } = await requestConfirmLink(page, request);
  const linkUrl = new URL(link);
  const formBody = {
    token: linkUrl.searchParams.get('token') ?? '',
    callbackURL: linkUrl.searchParams.get('callbackURL') ?? '/lobby',
  };
  // Two overlapping submissions of the very same token, fired together
  // rather than sequentially: the double submit a slow network or an
  // eager double-click produces. `page.request` shares the page's cookie jar, so whichever
  // submission actually signs in leaves its session cookie behind for
  // the page navigations below.
  const post = () =>
    page.request.post('/auth/confirm', {
      headers: { origin },
      form: formBody,
      maxRedirects: 0,
    });
  const [first, second] = await Promise.all([post(), post()]);

  const signedIn = [first, second].filter(
    (response) => response.headers()['set-cookie'],
  );
  // The redemption is atomic: exactly one submission signs in, whichever
  // arrived first; the other finds the token already spent.
  expect(signedIn.length).toBe(1);
  for (const response of [first, second]) expect(response.status()).toBe(303);

  // The winner's own redirect target is a real, working page.
  const winnerLocation = signedIn[0]?.headers()['location'] ?? '/lobby';
  await page.goto(winnerLocation);
  await expect(page).not.toHaveURL(/\/sign-in/);

  // The loser's redirect lands on the expired state, itself still usable:
  // the resend form and "Continue to Daisy Debate" both work from here.
  const loser = [first, second].find((response) => response !== signedIn[0]);
  await page.goto(loser?.headers()['location'] ?? '/auth/confirm');
  await expect(
    page.getByRole('heading', { name: /can no longer be used/i }),
  ).toBeVisible();
  const continueLink = page.getByRole('link', {
    name: /already signed in\? continue to daisy/i,
  });
  await continueLink.click();
  await expect(page).not.toHaveURL(/\/sign-in/);
});

test('the data-rights forms export a download and close the account (ISSUE-833)', async ({
  page,
  request,
}) => {
  const { email } = await signUpMember(request);
  // The page's own jar is a fresh anonymous browser: this member signs in
  // through the form.
  await page.goto('/sign-in?next=%2Flobby');
  await requestSignInLink(page, email);
  await confirmSignIn(page, await emailedLink(request, email));
  await page.goto('/settings#privacy');

  // The export is the download the form post itself answers.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download your data' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^daisy-export-.*\.json$/);
  await expect(page).toHaveURL(/\/settings/);

  // Erasure needs its confirmation: without it, the fixed notice returns.
  await page.getByRole('button', { name: 'Close your account' }).click();
  await expect(page).toHaveURL(/privacyErase=confirm$/);
  await expect(
    page.getByText('Tick the box to confirm you want your account closed.'),
  ).toBeVisible();

  // A confirmed erasure closes the account and signs this browser out.
  await page
    .getByRole('checkbox', { name: 'I understand this cannot be undone.' })
    .check();
  await page.getByRole('button', { name: 'Close your account' }).click();
  await expect(page).toHaveURL(/\/sign-in\?closed=1$/);
  await expect(page.getByText('Your account is closed.')).toBeVisible();
  // The closed session is really gone: the settings guard sends them away.
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/sign-in/);
});
