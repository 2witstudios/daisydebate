import { expect } from '@playwright/test';
import { test } from './fixtures';
import {
  composerRequestId,
  completedSend,
  durableMessage,
} from './messaging-completion';
import {
  withHeldConversation,
  beginHeldSend,
} from './messaging-navigation-overlap';

export function testMessagingUnknownCommit() {
  test('a committed send whose response is lost retries the exact command without another message', async ({
    browser,
  }) => {
    await withHeldConversation(
      browser,
      'lose',
      async ({ page, observed, held, channelId }) => {
        const requestId = await composerRequestId(page);
        const text = 'Retry the same unknown committed command';
        await beginHeldSend(page, held, text);
        const original = await durableMessage(page, channelId, text);
        await observed.heard(original.changeVersion);
        await expect(page.getByLabel('Your message')).toBeDisabled();
        await held.releaseSend();
        await expect(page.locator('#message-notice')).toHaveText(
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
        const retried = await completedSend(page, channelId, text, requestId);
        expect(retried.message.id).toBe(original.id);
        expect(retried.message.changeVersion).toBe(original.changeVersion);
        expect(held.state.sends).toBe(1);
      },
    );
  });
}
