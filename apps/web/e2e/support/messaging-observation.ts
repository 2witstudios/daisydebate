import type { Page } from '@playwright/test';
import { serverMessageSchema, type ServerMessage } from '@daisy/protocol';
import { messageInHistory } from './messaging-message-controls';
import { proveNativeTyping } from './messaging-typing';
import { expect, openPage } from './fixtures';
import {
  acceptMessagingJourney,
  type openMessagingJourney,
} from './messaging-journey';

type Journey = Awaited<ReturnType<typeof openMessagingJourney>>;
/** Records every socket frame and every page/RSC refetch the page makes. */
function observeTraffic(page: Page) {
  const frames: ServerMessage[] = [];
  const invalidFrames: string[] = [];
  const refetches: string[] = [];
  const typingHints: Extract<ServerMessage, { type: 'typing_changed' }>[] = [];
  page.on('websocket', (socket) =>
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
      frames.push(result.data);
      if (result.data.type === 'typing_changed') typingHints.push(result.data);
    }),
  );
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/messages') || url.searchParams.has('_rsc'))
      refetches.push(url.pathname);
  });
  return { frames, invalidFrames, refetches, typingHints };
}

/** A commit reaches the other browser as a snapshot: no page or RSC refetch. */
export async function proveSnapshotDelivery(journey: Journey) {
  const recipient = await acceptMessagingJourney(journey);
  const sender = await openPage(journey.sender, 'the realtime DM recipient');
  const traffic = observeTraffic(sender);
  await sender.goto(`/messages/${journey.channelId}`);
  await expect
    .poll(() =>
      traffic.frames.some((frame) => frame.type === 'observation.snapshot'),
    )
    .toBe(true);
  await proveNativeTyping(
    sender,
    recipient,
    journey.channelId,
    traffic.typingHints,
  );
  traffic.refetches.length = 0;
  const text = 'Delivered through a real authenticated socket';
  await recipient.getByLabel('Your message').fill(text);
  await recipient
    .getByRole('button', { name: 'Send message', exact: true })
    .click();
  await expect(messageInHistory(sender, text)).toHaveCount(1);
  expect(traffic.refetches).toEqual([]);
  expect(traffic.invalidFrames).toEqual([]);
  expect(traffic.frames.some((frame) => frame.type === 'event')).toBe(false);
}
/** MSG-5.3: an unsent edit survives content; revocation removes server text. */
export async function proveDraftAndRevocation(journey: Journey) {
  const recipient = await acceptMessagingJourney(journey);
  const sender = await openPage(journey.sender, 'the drafting sender');
  await sender.goto(`/messages/${journey.channelId}`);
  const own = 'Message about to be revised';
  await sender.getByLabel('Your message').fill(own);
  await sender
    .getByRole('button', { name: 'Send message', exact: true })
    .click();
  await messageInHistory(sender, own)
    .locator('xpath=ancestor::li')
    .getByRole('link', { name: 'Edit or remove your message', exact: true })
    .click();
  const draft = 'An unsent revision the sender is still typing';
  await sender.getByLabel('Revise your message').fill(draft);
  const posted = 'Another participant keeps talking';
  await recipient.getByLabel('Your message').fill(posted);
  await recipient
    .getByRole('button', { name: 'Send message', exact: true })
    .click();
  await expect(messageInHistory(recipient, posted)).toHaveCount(1);
  await expect(sender.getByLabel('Revise your message')).toHaveValue(draft);
  const other = await openPage(journey.sender, 'the signing-out tab');
  await other.goto('/lobby');
  const signOut = other.getByRole('button', {
    name: 'Sign out',
    exact: true,
  });
  await signOut.click();
  await other.waitForURL(/\/sign-in$/);
  await expect(sender.getByText('Conversation unavailable.')).toBeVisible({
    timeout: 10_000,
  });
  await expect(sender.getByLabel('Revise your message')).toHaveCount(0);
  await expect(sender.getByText(own)).toHaveCount(0);
}
