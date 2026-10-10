import { expect, type Page } from '@playwright/test';
import type { ServerMessage } from '@daisy/protocol';
import { messagingBrowserPolicy } from './messaging-policy';
/** Real composer -> canonical HTTP -> Redis lease -> PG hint -> WS -> aggregate refetch. */
export async function proveNativeTyping(
  sender: Page,
  typist: Page,
  channelId: string,
  hints: readonly Extract<ServerMessage, { type: 'typing_changed' }>[],
) {
  const timing = messagingBrowserPolicy.typing;
  if (!timing) throw new Error('Explicit typing fixture required');
  const draft = 'A draft that never becomes a durable message';
  await typist.getByLabel('Your message').fill(draft);
  await expect(
    sender.getByText('Someone is typing…', { exact: true }),
  ).toBeVisible();
  await expect.poll(() => hints.length).toBeGreaterThan(0);
  expect(
    hints.every(
      (frame) =>
        JSON.stringify(frame) ===
        JSON.stringify({
          v: 1,
          type: 'typing_changed',
          topic: `channel:${channelId}`,
        }),
    ),
  ).toBe(true);
  const own = await typist.request.get(
    `/api/messaging/channels/${channelId}/typing`,
  );
  expect(own.status()).toBe(200);
  expect((await own.json()).typing).toBe(false);
  // Drop renewals, not authority or responses; expiry must clear the observer without a stop hint.
  await typist.route('**/api/messaging/typing', (route) => route.abort());
  await expect(
    sender.getByText('Someone is typing…', { exact: true }),
  ).toHaveCount(0, { timeout: timing.ttlMs + timing.refetchMs * 2 });
  await typist.unroute('**/api/messaging/typing');
  await typist.getByLabel('Your message').fill('');
  const history = await sender.request.get(
    `/api/messaging/channels/${channelId}/messages`,
  );
  expect(history.status()).toBe(200);
  expect(JSON.stringify(await history.json())).not.toContain(draft);
}
