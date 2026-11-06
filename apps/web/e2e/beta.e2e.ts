import { preapproveEmail } from './support/preapproval';
import { expect, test } from './support/fixtures';
import {
  reachOnboardingFromRanked,
  freshEmail,
  emailedLink,
  requestSignInLink,
  confirmSignIn,
  answerAgeStep,
  signUpWaitlisted,
  uniqueName,
} from './support/accounts';
import { claimUsername, skipOnboarding } from './support/forms';
import { approveBetaAccounts } from './support/beta-access';

/**
 * ADR 0075: a new account finishes sign-up, then waits on the beta list.
 * Participant pages send it to /beta; its own settings stay open; an
 * operator's approval lets it in on the very next request.
 */
test('a waitlisted account waits on /beta until it is approved', async ({
  page,
}) => {
  const { email, username } = await signUpWaitlisted(page.request);

  await page.goto('/play');
  await expect(page).toHaveURL(/\/beta\?next=%2Fplay$/);
  await expect(
    page.getByRole('heading', { name: `You're on the list, @${username}` }),
  ).toBeVisible();

  await page.goto('/');
  await expect(page).toHaveURL(/\/beta\?next=%2F$/);

  await page.goto('/settings');
  await expect(page).toHaveURL(/\/settings$/);
  // ISSUE-690: the name it already claimed, never a prompt to choose one.
  await expect(page.getByRole('link', { name: `@${username}` })).toBeVisible();
  await expect(page.locator('a[href="/onboarding/username"]')).toHaveCount(0);

  await approveBetaAccounts(email);
  await page.goto('/beta?next=%2Fplay');
  await expect(page).toHaveURL(/\/play$/);
});

test('a fresh sign-up from a protected page finishes onboarding on /beta and reaches that page once approved', async ({
  page,
  request,
}) => {
  const email = await reachOnboardingFromRanked(page, request);
  const username = uniqueName('waiting');
  await claimUsername(page, username);
  await page.getByRole('button', { name: 'Not now' }).click();
  // Skipping ends on the list: a waitlisted account never sees the send-off,
  // and the destination waits behind it.
  await expect(page).toHaveURL(/\/onboarding\/daisy\?next=/);
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page).toHaveURL(/\/beta\?next=%2Franked$/);
  await expect(
    page.getByRole('heading', { name: `You're on the list, @${username}` }),
  ).toBeVisible();

  await approveBetaAccounts(email);
  await page.reload();
  await expect(page).toHaveURL(/\/ranked$/);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  // ISSUE-691 (plan BETA §5): a waiting account can always leave.
  test('a waitlisted account signs out from /beta and lands signed out', async ({
    page,
  }) => {
    const { username } = await signUpWaitlisted(page.request);
    await page.goto('/beta');
    await expect(
      page.getByRole('heading', { name: `You're on the list, @${username}` }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.goto('/play');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

// Uses real account handlers and the durable operator operation; no access seeding.
test('a silently preapproved verified email still finishes onboarding', async ({
  page,
  request,
}) => {
  const email = await reachOnboardingFromRanked(page, request);
  await preapproveEmail(`  ${email.toUpperCase()} `);
  const username = uniqueName('invited');
  await claimUsername(page, username);
  await page.getByRole('button', { name: 'Not now' }).click();
  await skipOnboarding(page, /\/ranked$/);
});

test('a forwarded invitation grants no access to a different verified email', async ({
  page,
}) => {
  await preapproveEmail(`${uniqueName('forwarded')}@example.test`);
  // Invitation contains precisely the ordinary sign-in destination.
  await page.goto('/sign-in');
  await signUpWaitlisted(page.request);
  await page.goto('/play');
  await expect(page).toHaveURL(/\/beta\?next=%2Fplay$/);
});

test('an invited new person follows the ordinary sign-in link and completes every onboarding step', async ({
  page,
  request,
}) => {
  test.setTimeout(45000);
  const email = freshEmail();
  await preapproveEmail(email, true);
  let link = '';
  await expect(async () => {
    link = await emailedLink(request, email);
  }).toPass({ timeout: 25000 });
  const invitation = new URL(link);
  expect(invitation.pathname).toBe('/sign-in');
  expect(invitation.search).toBe('');
  await page.goto(link);
  await requestSignInLink(page, email);
  await confirmSignIn(page, await emailedLink(request, email));
  await answerAgeStep(page);
  await claimUsername(page, uniqueName('invited'));
  await page.getByRole('button', { name: 'Not now' }).click();
  await skipOnboarding(page, /\/lobby$/);
  await page.goto('/play');
  await expect(page).toHaveURL(/\/play$/);
});
