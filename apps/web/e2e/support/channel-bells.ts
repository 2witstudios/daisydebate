import { expect, type BrowserContext } from '@playwright/test';
import { serverMessageSchema } from '@daisy/protocol';
import { openPage } from './fixtures';

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
      let raw: unknown;
      try {
        raw = JSON.parse(String(payload));
      } catch {
        return;
      }
      const frame = serverMessageSchema.safeParse(raw);
      if (!frame.success) return;
      if (frame.data.type === 'subscribed' && frame.data.topic === topic)
        subscribed = true;
      if (
        frame.data.type === 'event' &&
        frame.data.payload.kind === 'channel.changed' &&
        frame.data.payload.channelId === channelId
      )
        changeVersions.push(frame.data.payload.changeVersion);
    }),
  );
  await page.goto(`/messages/${channelId}`);
  await expect.poll(() => subscribed).toBe(true);
  return { changeVersions, close: () => page.close() };
}
