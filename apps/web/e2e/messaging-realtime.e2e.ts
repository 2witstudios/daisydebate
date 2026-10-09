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
