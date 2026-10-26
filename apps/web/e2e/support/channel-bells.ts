import { expect, type BrowserContext, type Page } from '@playwright/test';
import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { openPage } from './fixtures';
import { serverFrame } from './subscription-ledger';
import { STEP_LIMIT_MS } from './bounded-step';

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
  await expect.poll(() => subscribed, { timeout: STEP_LIMIT_MS }).toBe(true);
  return {
    /** Resolves once a bell at `changeVersion` or later has been delivered. */
    heard: (changeVersion: number) =>
      expect
        .poll(() => Math.max(0, ...changeVersions), { timeout: STEP_LIMIT_MS })
        .toBeGreaterThanOrEqual(changeVersion),
    close: () => page.close(),
  };
}

/**
 * Setup uses the actual authenticated send route and this rendered composer's
 * request ID. The seed's doorbell rings after the POST answers: a bell still
 * in flight when the control page subscribes refetches that page and remounts
 * its form mid-proof, dropping the notice and the retained draft. Another
 * member's subscribed page hears the bell first, so it has already rung.
 */
export async function seedControlMessage(
  page: Page,
  channelId: string,
  member: BrowserContext,
) {
  const bells = await listenForChannelBells(member, channelId);
  try {
    const requestId = await page
      .getByLabel('Your message')
      .locator('xpath=ancestor::form')
      .locator('input[name="requestId"]')
      .inputValue();
    const text = 'Keyboard message controls contribution';
    const response = await page.request.post('/api/messaging/messages', {
      headers: { origin: new URL(page.url()).origin },
      data: { version: 1, channelId, requestId, text },
    });
    expect(response.ok()).toBe(true);
    const seeded = seededMessageSchema.parse(await response.json());
    await bells.heard(seeded.changeVersion);
    const { id, changeVersion } = seeded;
    return {
      id,
      changeVersion,
      text,
      path: `/messages/${channelId}/message?messageId=${id}`,
    };
  } finally {
    await bells.close();
  }
}

const seededMessageSchema = z.object({
  id: idSchema,
  changeVersion: z.number().int().positive(),
});
