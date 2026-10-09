import { test, expect, openPage } from './support/fixtures';
import {
  openMessagingJourney,
  acceptMessagingJourney,
} from './support/messaging-journey';

for (const javaScriptEnabled of [true, false]) {
  test(`a recipient accepts a DM and sends durable history with JavaScript ${javaScriptEnabled ? 'enabled' : 'disabled'}`, async ({
    browser,
  }) => {
    const journey = await openMessagingJourney(browser, javaScriptEnabled);
    try {
      const recipient = await acceptMessagingJourney(journey);
      const text = 'Native browser DM history';
      await recipient.getByLabel('Your message').fill(text);
      await recipient
        .getByRole('button', { name: 'Send message', exact: true })
        .click();
      await expect(
        recipient
          .getByRole('list', { name: 'Message history' })
          .getByText(text, { exact: true }),
      ).toBeVisible();
      const sender = await openPage(
        journey.sender,
        'the sender durable history',
      );
      await sender.goto(`/messages/${journey.channelId}`);
      await expect(
        sender
          .getByRole('list', { name: 'Message history' })
          .getByText(text, { exact: true }),
      ).toHaveCount(1);
      const foreign = await journey.outsider.request.get(
        `/api/messaging/channels/${journey.channelId}/messages`,
      );
      expect([403, 404]).toContain(foreign.status());
      const foreignSearch = await journey.outsider.request.get(
        `/api/messaging/channels/${journey.channelId}/messages/search?query=browser`,
      );
      expect([403, 404]).toContain(foreignSearch.status());
      await sender
        .getByRole('searchbox', { name: 'Search messages' })
        .fill('browser');
      await sender.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(
        sender
          .getByRole('list', { name: 'Message history' })
          .getByText(text, { exact: true }),
      ).toHaveCount(1);
      await sender
        .getByRole('searchbox', { name: 'Search messages' })
        .fill('%');
      await sender.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(
        sender.getByText('No matching messages.', { exact: true }),
      ).toBeVisible();
      await sender
        .getByRole('link', { name: 'Clear search', exact: true })
        .click();
      await sender.reload();
      await expect(
        sender
          .getByRole('list', { name: 'Message history' })
          .getByText(text, { exact: true }),
      ).toHaveCount(1);
    } finally {
      await journey.close();
    }
  });
}
