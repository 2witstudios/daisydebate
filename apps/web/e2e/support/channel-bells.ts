import { expect, type BrowserContext } from '@playwright/test';
import { openPage } from './fixtures';
import { serverFrame } from './subscription-ledger';

/** A member's conversation page, subscribed to the channel's doorbells. */
export async function listenForChannelBells(
  context: BrowserContext,
  channelId: string,
) {
  const page = await openPage(context, 'the seeded message doorbell');
  const topic = `channel:${channelId}`;
  let subscribed = false;
  const changeVersions: number[] = [];
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      const frame = serverFrame(payload);
      if (frame?.type === 'subscribed' && frame.topic === topic)
        subscribed = true;
      if (
        frame?.type === 'event' &&
        frame.payload.kind === 'channel.changed' &&
        frame.payload.channelId === channelId
      )
        changeVersions.push(frame.payload.changeVersion);
    }),
  );
  await page.goto(`/messages/${channelId}`);
  await expect.poll(() => subscribed).toBe(true);
  return { changeVersions, close: () => page.close() };
}
