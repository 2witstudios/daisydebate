import { expect, type Page, type Browser } from '@playwright/test';
import { openPage } from './fixtures';
import {
  openMessagingGroupJourney,
  manageNativeMessagingGroup,
} from './messaging-journey';
/** Both JavaScript modes use the actual native reaction action and current summary route. */
export async function manageNativeReactions(
  page: Page,
  channelId: string,
  text: string,
) {
  const row = page
    .getByRole('list', { name: 'Message history' })
    .getByRole('listitem')
    .filter({ hasText: text });
  await row.getByRole('link', { name: 'Reactions', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Message reactions' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'React 👍', exact: true }).click();
  await expect(
    page.getByRole('list', { name: 'Current reactions' }),
  ).toContainText('👍 · 1 · You reacted');
  await expect(
    page.getByRole('button', { name: 'Remove 👍', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Remove 👍', exact: true }).click();
  await expect(
    page.getByRole('list', { name: 'Current reactions' }).getByRole('listitem'),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'React 👍', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Back to conversation', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/messages/${channelId}$`));
}

/** A valid session keeps a stale tab while another member revokes and restores admission. */
export async function openRefusedMessageControls(browser: Browser) {
  const journey = await openMessagingGroupJourney(browser);
  try {
    const page = await openPage(
      journey.recipient,
      'stale member message controls',
    );
    await admitGroupPage(page, journey.channelId);
    let held = false;
    // Hold only push invalidations, modelling a tab that has not received the revocation.
    // HTTP actions still reach the real production server with the valid session.
    await page.routeWebSocket('**/ws', (socket) => {
      const server = socket.connectToServer();
      server.onMessage((message) => {
        if (!held) socket.send(message);
      });
      server.onClose((code, reason) => {
        if (!held)
          void socket.close({
            ...(code === undefined ? {} : { code }),
            ...(reason === undefined ? {} : { reason }),
          });
      });
    });
    const manager = await openPage(
      journey.sender,
      'actual group admission manager',
    );
    return {
      journey,
      page,
      async refuse() {
        held = true;
        await manageNativeMessagingGroup(
          manager,
          journey.channelId,
          'remove',
          journey.recipientUsername,
        );
        const response = await page.request.get(
          `/api/messaging/channels/${journey.channelId}/messages`,
        );
        expect(response.status()).toBe(404);
        const session = await page.request.get(
          '/api/auth/get-session?disableCookieCache=true',
        );
        expect(await session.json()).not.toBeNull();
      },
      async recover(buttonName: string) {
        await manageNativeMessagingGroup(
          manager,
          journey.channelId,
          'invite',
          journey.recipientUsername,
        );
        const admission = await openPage(
          journey.recipient,
          'restored real group admission',
        );
        try {
          await admitGroupPage(admission, journey.channelId);
          if (buttonName === 'Remove 👍') {
            // Restore an absent association through a fresh native command if needed.
            await admission.goto(page.url());
            await expect(
              admission.getByRole('button', { name: /^(React|Remove) 👍$/ }),
            ).toBeVisible();
            const add = admission.getByRole('button', {
              name: 'React 👍',
              exact: true,
            });
            if ((await add.count()) === 1) await add.click();
            await expect(
              admission.getByRole('button', { name: 'Remove 👍', exact: true }),
            ).toBeVisible();
          }
        } finally {
          await admission.close();
        }
        held = false;
      },
    };
  } catch (error) {
    await journey.close();
    throw error;
  }
}

async function admitGroupPage(page: Page, channelId: string) {
  await page.goto(`/messages/groups/invitations/${channelId}`);
  await page
    .getByRole('button', { name: 'Accept invitation', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/messages/${channelId}$`));
}
