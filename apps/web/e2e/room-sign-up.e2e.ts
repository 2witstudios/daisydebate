import { expect, openPage, test } from './support/fixtures';
import {
  answerAgeStep,
  confirmSignIn,
  emailedLink,
  freshEmail,
  origin,
  requestSignInLink,
  resetRateLimits,
  signUpMember,
  uniqueName,
} from './support/accounts';
import { approveBetaAccounts } from './support/beta-access';
import { claimUsername } from './support/forms';
import { walkOnboarding } from './support/onboarding';
import { closeRoom, createConfiguredRoom } from './support/room-launch-flow';

for (const javaScriptEnabled of [true, false]) {
  test(`a reusable room link survives sign-up without granting beta access (JavaScript ${javaScriptEnabled})`, async ({
    browser,
    page: host,
  }) => {
    await signUpMember(host.request);
    await host.goto('/play/room');
    const form = host.getByRole('form', { name: 'Create a room' });
    const title = uniqueName('shared');
    await form.getByLabel('Room name', { exact: true }).fill(title);
    await form.getByLabel('Who can join').selectOption('unlisted');
    const room = await createConfiguredRoom(host);
    const destination = `/rooms/${room.id}`;
    const context = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      javaScriptEnabled,
    });
    try {
      const guest = await openPage(context, 'shared room recipient sign-up');
      await resetRateLimits(guest.request);
      await guest.goto(destination);
      expect(new URL(guest.url()).pathname).toBe('/sign-in');
      expect(new URL(guest.url()).searchParams.get('next')).toBe(destination);
      const email = freshEmail();
      await requestSignInLink(guest, email);
      await confirmSignIn(guest, await emailedLink(guest.request, email));
      expect(new URL(guest.url()).searchParams.get('next')).toBe(destination);
      await answerAgeStep(guest);
      expect(new URL(guest.url()).searchParams.get('next')).toBe(destination);
      await claimUsername(guest, uniqueName('recipient'));
      await guest.getByRole('button', { name: 'Not now' }).click();
      await guest.getByRole('button', { name: 'Skip' }).click();
      await expect(guest).toHaveURL(/\/beta\?next=/);
      expect(new URL(guest.url()).searchParams.get('next')).toBe(destination);
      expect((await guest.request.get(`/api/rooms/${room.id}`)).ok()).toBe(
        false,
      );

      // Approval remains an explicit, separate operator action.
      await approveBetaAccounts(email);
      await guest.reload();
      await expect(guest).toHaveURL(destination);
      await guest.goto(
        `/onboarding/daisy?next=${encodeURIComponent(destination)}`,
      );
      if (javaScriptEnabled) await walkOnboarding(guest, destination);
      else await guest.getByRole('button', { name: 'Skip' }).click();
      await expect(
        guest.getByRole('link', { name: 'Enter the lobby' }),
      ).toHaveAttribute('href', destination);
      await guest.getByRole('link', { name: 'Enter the lobby' }).click();
      await expect(guest).toHaveURL(destination);
      await expect(
        guest.getByRole('heading', { name: title, exact: true }),
      ).toBeVisible();
      const signedOut = await guest.request.post('/api/auth/sign-out', {
        headers: { origin },
        data: {},
      });
      expect(signedOut.ok()).toBe(true);
      await resetRateLimits(guest.request);
      await guest.goto(destination);
      await expect(guest).toHaveURL(/\/sign-in\?next=/);
      await requestSignInLink(guest, email);
      await confirmSignIn(guest, await emailedLink(guest.request, email));
      await expect(guest).toHaveURL(destination);
      // The same link remains useful on a later navigation, without consuming an invite.
      await guest.goto('/lobby');
      await guest.goto(destination);
      await expect(
        guest.getByRole('heading', { name: title, exact: true }),
      ).toBeVisible();
    } finally {
      await context.close();
      await closeRoom(host.request, room.id);
    }
  });
}
