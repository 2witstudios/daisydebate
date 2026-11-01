import { expect } from '@playwright/test';
import { test } from './fixtures';
import {
  openMessagingJourney,
  acceptMessagingJourney,
} from './messaging-journey';
import {
  composerRequestId,
  completedSend,
  durableMessage,
} from './messaging-completion';
import { holdConversationResponses } from './messaging-navigation-overlap';
import { watchChannelObservation } from './channel-observation';
import { effectsRan } from './hydration';

export function testMessagingUnknownCommit() {
  test('a committed send whose response is lost retries the exact command without another message', async ({
    browser,
  }) => {
    const journey = await openMessagingJourney(browser);
    let held: ReturnType<typeof holdConversationResponses> | undefined;
    try {
      const page = await acceptMessagingJourney(journey);
      const observed = watchChannelObservation(page, journey.channelId);
      await page.reload();
      await observed.ready();
      await effectsRan(page);
      held = holdConversationResponses(
        page,
        journey.channelId,
        'editor',
        'lose',
      );
      await page.route('**/messages/**', held.intercept);
      const requestId = await composerRequestId(page);
      const text = 'Retry the same unknown committed command';
      await page.getByLabel('Your message').fill(text);
      await page
        .getByRole('button', { name: 'Send message', exact: true })
        .click();
      await expect.poll(() => held!.state.sendReady).toBe(true);
      const original = await durableMessage(page, journey.channelId, text);
      await observed.heard(original.changeVersion);
      await expect(page.getByLabel('Your message')).toBeDisabled();
      await held.releaseSend();
      await expect(page.getByRole('status')).toHaveText(
        'Message could not be sent. Your draft is kept; try again.',
      );
      await expect(page.getByLabel('Your message')).toHaveValue(text);
      expect(await composerRequestId(page)).toBe(requestId);
      const send = page.getByRole('button', {
        name: 'Send message',
        exact: true,
      });
      await expect(send).toBeEnabled();
      await page.unroute('**/messages/**', held.intercept);
      await send.click();
      const retried = await completedSend(
        page,
        journey.channelId,
        text,
        requestId,
      );
      expect(retried.message.id).toBe(original.id);
      expect(retried.message.changeVersion).toBe(original.changeVersion);
      expect(held.state.sends).toBe(1);
    } finally {
      held?.releaseAll();
      await journey.close();
    }
  });
}
