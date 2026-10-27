import type { Browser } from '@playwright/test';
import { expect, openPage, test } from './fixtures';
import { openMessagingJourney } from './messaging-journey';

/**
 * Both sides of a pending request press Message on each other's profile:
 * the requester reaches their sent status, the requested member the request.
 */
async function proveProfileMessageEntry(
  browser: Browser,
  javaScriptEnabled: boolean,
) {
  const journey = await openMessagingJourney(browser, javaScriptEnabled);
  try {
    const sender = await openPage(journey.sender, 'the requester profile');
    await sender.goto(`/profile/${journey.recipientUsername}`);
    await sender
      .getByRole('button', {
        name: `Message @${journey.recipientUsername}`,
        exact: true,
      })
      .click();
    await expect(sender).toHaveURL(
      new RegExp(`/messages/requests/${journey.channelId}/status$`),
    );
    const recipient = await openPage(
      journey.recipient,
      'the requested member profile',
    );
    await recipient.goto(`/profile/${journey.senderUsername}`);
    await recipient
      .getByRole('button', {
        name: `Message @${journey.senderUsername}`,
        exact: true,
      })
      .click();
    await expect(recipient).toHaveURL(
      new RegExp(`/messages/requests/${journey.channelId}$`),
    );
    await expect(
      recipient.getByText(journey.introduction, { exact: true }),
    ).toBeVisible();
  } finally {
    await journey.close();
  }
}

export function testProfileMessageEntry() {
  for (const javaScriptEnabled of [true, false])
    test(`a profile's Message button opens the existing request from either side (JavaScript ${javaScriptEnabled ? 'on' : 'off'})`, async ({
      browser,
    }) => {
      await proveProfileMessageEntry(browser, javaScriptEnabled);
    });
}
