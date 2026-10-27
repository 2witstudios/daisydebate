import { expect, test } from './support/fixtures';
import {
  answerAgeStep,
  confirmSignIn,
  emailedLink,
  freshEmail,
  requestSignInLink,
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

  await approveBetaAccounts(email);
  await page.goto('/beta?next=%2Fplay');
  await expect(page).toHaveURL(/\/play$/);
});

test('a fresh sign-up from a protected page finishes onboarding on /beta and reaches that page once approved', async ({
  page,
  request,
}) => {
  await page.goto('/ranked');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Franked$/);
  const email = freshEmail();
  await requestSignInLink(page, email);
  await confirmSignIn(page, await emailedLink(request, email));
  await answerAgeStep(page);
  await expect(page).toHaveURL(/\/onboarding\/username\?next=(\/|%2F)ranked$/);
  const username = uniqueName('waiting');
  await claimUsername(page, username);
  await page.getByRole('button', { name: 'Not now' }).click();
  // Onboarding finishes as usual; the destination waits behind the list.
  await skipOnboarding(page, /\/beta\?next=%2Franked$/);
  await expect(
    page.getByRole('heading', { name: `You're on the list, @${username}` }),
  ).toBeVisible();

  await approveBetaAccounts(email);
  await page.reload();
  await expect(page).toHaveURL(/\/ranked$/);
});
