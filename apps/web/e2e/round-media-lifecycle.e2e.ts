import { roundMediaStateSchema } from '@daisy/protocol';
import { test, expect, openPage } from './support/fixtures';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { createLaunchContexts } from './support/room-launch-contexts';
import {
  origin,
  signUpMember,
  requestSignInLink,
  confirmSignIn,
  emailedLink,
} from './support/accounts';
import { closeSettledLaunchContexts } from './support/room-launch-settled';
import {
  createHumanBallotRound,
  readBallotRound,
} from './support/human-ballot-round';
import { MEDIA_POLL, grantMedia, expectConnected } from './support/round-media';

test('canceled and unacknowledged leave retain recovery; acknowledged departure and terminal do not resume', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const round = await createHumanBallotRound(accounts.members, 0);
    const owner = accounts.members[0]!;
    await grantMedia(accounts.members);
    const page = await openPage(owner.context, 'departure recovery');
    const href = `/rounds/${round.id}/room`;
    await page.goto(href);
    await expectConnected(page);
    await page.getByRole('link', { name: 'Leave round', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Leave the round?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('link', { name: 'Stay', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.goto('/');
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expectConnected(page);
    await page.getByRole('link', { name: 'Leave round', exact: true }).click();
    const confirm = dialog.getByRole('button', {
      name: 'Leave and forfeit',
      exact: true,
    });
    const commandId = await confirm
      .locator('..')
      .locator('input[name=commandId]')
      .inputValue();
    let intercepted = false;
    await page.route(`**${href}`, async (route) => {
      const request = route.request();
      if (
        !intercepted &&
        request.method() === 'POST' &&
        request.headers()['next-action'] &&
        request.postData()?.includes(commandId)
      ) {
        intercepted = true;
        // Owned transport fault before dispatch: the browser cannot infer
        // acknowledgement and canonical membership is still active.
        await route.fulfill({
          status: 503,
          contentType: 'text/plain',
          body: 'Unavailable acknowledgement',
        });
      } else await route.continue();
    });
    await confirm.click();
    await expect(
      dialog.getByText(
        'The command is not acknowledged. Review the current round before trying again.',
        { exact: true },
      ),
    ).toBeVisible();
    expect(intercepted).toBe(true);
    expect(
      (await readBallotRound(owner.context.request, round.id)).status,
    ).not.toBe('completed');
    await page.unroute(`**${href}`);
    await dialog.getByRole('link', { name: 'Stay', exact: true }).click();
    await page.goto('/lobby');
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expectConnected(page);
    const local = await page
      .getByLabel('Your camera', { exact: true })
      .evaluateHandle(
        (node) =>
          (
            (node as HTMLVideoElement).srcObject as MediaStream
          ).getVideoTracks()[0]!,
      );
    await page.getByRole('link', { name: 'Leave round', exact: true }).click();
    await dialog
      .getByRole('button', { name: 'Leave and forfeit', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/rounds/${round.id}$`));
    await expect
      .poll(() => local.evaluate((track) => track.readyState), MEDIA_POLL)
      .toBe('ended');
    await local.dispose();
    for (const entry of ['/', '/lobby']) {
      await page.goto(entry);
      await expect(page).toHaveURL(
        new RegExp(`${entry === '/' ? '/$' : '/lobby$'}`),
      );
      await expect(page.getByLabel('Your camera', { exact: true })).toHaveCount(
        0,
      );
    }
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('actual sign-out and emailed sign-in return to the authorized live Round', async ({
  browser,
}) => {
  const emails: string[] = [];
  const accounts = await createLaunchContexts(
    2,
    () => browser.newContext({ baseURL: origin, ignoreHTTPSErrors: false }),
    async (context) => {
      const member = await signUpMember(context.request);
      emails.push(member.email);
      return member;
    },
  );
  try {
    const round = await createHumanBallotRound(accounts.members, 0);
    await grantMedia(accounts.members);
    const owner = accounts.members[0]!;
    const page = await openPage(owner.context, 'authenticated rejoin');
    const href = `/rounds/${round.id}/room`;
    await page.goto(href);
    await expectConnected(page);
    await page.goto('/settings/security');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto(href);
    await expect(page).toHaveURL(/\/sign-in/);
    await requestSignInLink(page, emails[0]!);
    await confirmSignIn(
      page,
      await emailedLink(owner.context.request, emails[0]!),
    );
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expectConnected(page);
    await expect(page.getByLabel('Your camera', { exact: true })).toBeVisible(
      MEDIA_POLL,
    );
    const response = await owner.context.request.get(
      `/api/rounds/${round.id}/media`,
    );
    expect(response.status()).toBe(200);
    expect(
      roundMediaStateSchema.parse(await response.json()).grants.subscribe,
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath('signed-in-round-recovery.png'),
    });
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});
