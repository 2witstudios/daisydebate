import { expect, test } from '@playwright/test';
import { origin, resetRateLimits, signUpMember } from './support/accounts';
import { addVirtualAuthenticator } from './support/webauthn';

/**
 * Passkey sign-in from browser autofill (conditional mediation), end to end
 * over the production build. Only the chromium-mobile project runs this file
 * (playwright.config.ts): its virtual authenticator answers a conditional
 * request with its one discoverable credential, standing in for the person
 * picking it from the autofill list. Desktop Chromium waits for a selection
 * in browser UI the driver cannot make.
 */
test.beforeEach(async ({ request }) => {
  await resetRateLimits(request);
});

test('a saved passkey signs in from autofill without the button', async ({
  page,
  browser,
}) => {
  // Enroll on one device, then carry the passkey to a fresh, signed-out
  // browser, so the only way the page can sign in is the autofill request.
  const enrolling = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: origin,
  });
  const enrollPage = await enrolling.newPage();
  const device = await addVirtualAuthenticator(enrollPage);
  await signUpMember(enrollPage.request);
  await enrollPage.goto('/settings/security');
  await enrollPage.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(
    enrollPage.getByRole('button', { name: 'Rename' }),
  ).toBeVisible();
  const passkeys = await device.credentials();
  await enrolling.close();

  await addVirtualAuthenticator(page, passkeys);
  await page.goto('/sign-in?next=%2Flobby');
  await expect(page).toHaveURL(/\/lobby$/);
});
