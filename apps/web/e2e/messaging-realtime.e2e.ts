import { serverMessageSchema } from '@daisy/protocol';
import { test, expect, openPage } from './support/fixtures';
import {
  openMessagingJourney,
  acceptMessagingJourney,
} from './support/messaging-journey';

test('an authenticated DM doorbell refetches current history in the other real browser', async ({
  browser,
}) => {
  const journey = await openMessagingJourney(browser);
  try {
    const recipient = await acceptMessagingJourney(journey);
    const sender = await openPage(journey.sender, 'the realtime DM recipient');
    const subscribed: string[] = [];
    const bells: unknown[] = [];
    const invalidFrames: string[] = [];
    sender.on('websocket', (socket) =>
      socket.on('framereceived', (frame) => {
        let raw: unknown;
        try {
          raw = JSON.parse(String(frame.payload));
        } catch {
          invalidFrames.push('invalid JSON');
          return;
        }
        const result = serverMessageSchema.safeParse(raw);
        if (!result.success) {
          invalidFrames.push('invalid framing');
          return;
        }
        if (result.data.type === 'subscribed')
          subscribed.push(result.data.topic);
        if (result.data.type === 'event') bells.push(result.data.payload);
      }),
    );
    await sender.goto(`/messages/${journey.channelId}`);
    await expect
      .poll(() => subscribed.includes(`channel:${journey.channelId}`))
      .toBe(true);
    const text = 'Delivered through a real authenticated socket';
    await recipient.getByLabel('Your message').fill(text);
    await recipient
      .getByRole('button', { name: 'Send message', exact: true })
      .click();
    await expect(
      sender
        .getByRole('list', { name: 'Message history' })
        .getByText(text, { exact: true }),
    ).toHaveCount(1);
    expect(
      bells.some(
        (payload) =>
          typeof payload === 'object' &&
          payload !== null &&
          'kind' in payload &&
          payload.kind === 'channel.changed',
      ),
    ).toBe(true);
    expect(JSON.stringify(bells)).not.toContain(text);
    expect(invalidFrames).toEqual([]);
  } finally {
    await journey.close();
  }
});

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
