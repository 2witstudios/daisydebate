import { expect, test, type Page } from '@playwright/test';
import {
  emailedLink,
  freshEmail,
  confirmSignIn,
  requestSignInLink,
  resetRateLimits,
  signUpMember,
  uniqueName,
} from './support/accounts';

// The whole sign-in journey in a real browser against the production build:
// request a link on /sign-in, open the emailed link, get a session, pick a
// username, reach a protected page. Mail is captured off the wire by the e2e
// server; nothing is seeded and no session is pre-created.
test.beforeEach(async ({ request }) => {
  await resetRateLimits(request);
});

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
  await requestSignInLink(page, email);
  const link = await emailedLink(request, email);
  await confirmSignIn(page, link);

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
  await requestSignInLink(otherPage, otherEmail);
  await confirmSignIn(otherPage, await emailedLink(request, otherEmail));
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
  await requestSignInLink(page, email);
  const link = await emailedLink(request, email);
  await confirmSignIn(page, link);
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
  await expect(page).toHaveURL(/\/onboarding\/username/);

  // Walk away without choosing a name, then sign in again later.
  await page.context().clearCookies();
  await resetRateLimits(request);
  await page.goto('/sign-in?next=%2Franked');
  await requestSignInLink(page, email);
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
  await requestSignInLink(page, email);
  await confirmSignIn(page, await emailedLink(request, email));
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
  const otherPage = await other.newPage();
  await confirmSignIn(otherPage, link);
  await expect(otherPage).toHaveURL(/\/onboarding\/username/, {
    timeout: 15_000,
  });
  await claimUsername(otherPage, uniqueName('cross-browser'));
  // Whether the fresh context offers a passkey save depends on that
  // context's own WebAuthn availability, and how long the claim itself
  // takes under load; race the two possible outcomes instead of assuming
  // either happens within a short fixed window, so neither is checked
  // before the app has actually settled on one.
  const offered = await Promise.race([
    otherPage
      .getByRole('heading', { name: /next time, one tap/i })
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true),
    otherPage.waitForURL(/\/lobby$/, { timeout: 15_000 }).then(() => false),
  ]).catch(() => false);
  if (offered) await otherPage.getByRole('button', { name: 'Not now' }).click();
  await expect(otherPage).toHaveURL(/\/lobby$/, { timeout: 15_000 });

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
  await requestSignInLink(page, email);
  await confirmSignIn(page, await emailedLink(request, email));
  await expect(page).toHaveURL(/\/onboarding\/username/);

  // A reload mid-flow must not sign the person out or drop the destination.
  await page.reload();
  await expect(page).toHaveURL(/\/onboarding\/username/);

  const name = uniqueName('resumed');
  await claimUsername(page, name);
  await expect(
    page.getByRole('heading', { name: /next time, one tap/i }),
  ).toBeVisible();

  // Going back to the (now-completed) onboarding step and forward again must
  // not re-open a claim for an account that already has a username: the
  // server-rendered onboarding page recognizes completion and sends the
  // account straight past the passkey offer to its destination.
  await page.goBack();
  await page.goForward();
  await expect(page).toHaveURL(/\/lobby$/);

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

test('the topbar offers sign-in to a visitor', async ({ page }) => {
  // ISSUE-19: on every frame from the first paint until the layout settles,
  // the topmost element at the centre of the topbar's Sign in link must be
  // that link, never a sidebar or rail layer painted over the topbar.
  await page.addInitScript(() => {
    const covered: string[] = [];
    Reflect.set(window, '__topbarCovered', covered);
    const check = () => {
      const links = Array.from(document.querySelectorAll('header a')).filter(
        (link) => link.textContent?.trim() === 'Sign in',
      );
      for (const link of links) {
        const box = link.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        const top = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        if (top && !link.contains(top))
          covered.push(
            `${document.readyState}: under ${top.tagName.toLowerCase()} in ${top.closest('aside, nav, main, header')?.getAttribute('aria-label') ?? 'body'}`,
          );
      }
      if (!Reflect.get(window, '__topbarSettled')) requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
  await page.goto('/');
  const signIn = page
    .getByRole('banner')
    .getByRole('link', { name: 'Sign in' });
  await expect(signIn).toBeVisible();
  // The layout is final once every image the viewport shows has loaded;
  // lazy images below the fold never start and cannot move the topbar.
  await page.waitForFunction(() =>
    Array.from(document.images)
      .filter((image) => {
        const box = image.getBoundingClientRect();
        return box.bottom > 0 && box.top < innerHeight && box.width > 0;
      })
      .every((image) => image.complete),
  );
  await page.evaluate(() => Reflect.set(window, '__topbarSettled', true));
  expect(
    await page.evaluate(() => Reflect.get(window, '__topbarCovered')),
  ).toEqual([]);
  await signIn.click();
  await expect(page).toHaveURL(/\/sign-in$/);
});
