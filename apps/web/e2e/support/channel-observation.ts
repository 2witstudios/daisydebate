import { expect, type BrowserContext, type Page } from '@playwright/test';
import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { openPage } from './fixtures';
import { serverFrame } from './subscription-ledger';
import { STEP_LIMIT_MS } from './bounded-step';

/**
 * Records a page's observation of a channel's messages (ADR 0089): whether
 * the server admitted it (`observation.ready`) and the content revisions of
 * the snapshots it received. Attach before the page navigates.
 */
export function watchChannelObservation(page: Page, channelId: string) {
  let ready = false;
  const revisions: number[] = [];
  const snapshots: unknown[] = [];
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      const frame = serverFrame(payload);
      if (
        frame?.type === 'observation.ready' &&
        frame.resource.id === channelId
      )
        ready = true;
      if (
        frame?.type === 'observation.snapshot' &&
        frame.resource.id === channelId
      ) {
        revisions.push(frame.contentRevision);
        snapshots.push(frame.body);
      }
    }),
  );
  return {
    ready: () =>
      expect.poll(() => ready, { timeout: STEP_LIMIT_MS }).toBe(true),
    /** Resolves once a snapshot at `revision` or later has been delivered. */
    heard: (revision: number) =>
      expect
        .poll(() => Math.max(0, ...revisions), { timeout: STEP_LIMIT_MS })
        .toBeGreaterThanOrEqual(revision),
    snapshots: () => snapshots,
  };
}

/** A member's conversation page, observing the channel's messages. */
export async function listenForChannelObservation(
  context: BrowserContext,
  channelId: string,
) {
  const page = await openPage(context, 'the seeded message observer');
  const observed = watchChannelObservation(page, channelId);
  await page.goto(`/messages/${channelId}`);
  await observed.ready();
  return { heard: observed.heard, close: () => page.close() };
}

/**
 * Setup uses the actual authenticated send route and this rendered composer's
 * request ID, then waits until another member's page has observed the new
 * revision, so the seed is committed and delivered before the proof starts.
 */
export async function seedControlMessage(
  page: Page,
  channelId: string,
  member: BrowserContext,
) {
  const observed = await listenForChannelObservation(member, channelId);
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
    await observed.heard(seeded.changeVersion);
    const { id, changeVersion } = seeded;
    return {
      id,
      changeVersion,
      text,
      path: `/messages/${channelId}/message?messageId=${id}`,
    };
  } finally {
    await observed.close();
  }
}

const seededMessageSchema = z.object({
  id: idSchema,
  changeVersion: z.number().int().positive(),
});
