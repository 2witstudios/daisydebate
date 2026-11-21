import { expect } from '@playwright/test';
import { test } from './fixtures';
import { effectsRan } from './hydration';
import {
  completedSend,
  composerRequestId,
  durableMessage,
} from './messaging-completion';
import {
  acceptMessagingJourney,
  openMessagingJourney,
} from './messaging-journey';

/**
 * ISSUE-642 (DEC-124): the composer counts UTF-16 units against the beta
 * limit; one unit over is announced and blocked without cutting the draft,
 * and exactly the limit sends.
 */
export function testComposerCharacterLimit() {
  test('the composer counts UTF-16 units and blocks one over without truncating', async ({
    browser,
  }, info) => {
    const journey = await openMessagingJourney(browser);
    try {
      const page = await acceptMessagingJourney(journey);
      await effectsRan(page);
      const composer = page.getByRole('textbox', {
        name: 'Your message',
        exact: true,
      });
      // A supplementary character is two units: 3,999 + 2 is one over.
      const over = `${'x'.repeat(3999)}😀`;
      await composer.fill(over);
      await expect(page.getByText('4,001 / 4,000 characters')).toBeVisible();
      await expect(page.locator('#message-text-over')).toHaveText(
        '1 character over the limit. Shorten it to send.',
      );
      await expect(composer).toHaveAttribute('aria-invalid', 'true');
      await page
        .getByRole('button', { name: 'Send message', exact: true })
        .click();
      await expect(composer).toHaveValue(over);
      expect(
        await composer.evaluate((field) => field.matches(':invalid')),
      ).toBe(true);
      const exact = `${'x'.repeat(3998)}😀`;
      await composer.fill(exact);
      await expect(page.getByText('4,000 / 4,000 characters')).toBeVisible();
      await expect(composer).not.toHaveAttribute('aria-invalid');
      const requestId = await composerRequestId(page);
      const path = `/messages/${journey.channelId}`;
      const actionResponse = Promise.withResolvers<{
        status: number;
        body: string;
        revalidation: string | undefined;
      }>();
      await page.route(
        (url) => url.pathname === path,
        async (route) => {
          const request = route.request();
          if (
            request.method() !== 'POST' ||
            !('next-action' in request.headers())
          )
            return route.continue();
          // Read the actual Flight response before delivering it to a browser
          // that can immediately navigate away and release its response body.
          const response = await route.fetch();
          actionResponse.resolve({
            status: response.status(),
            body: await response.text(),
            revalidation: response.headers()['x-action-revalidated'],
          });
          await route.fulfill({ response });
        },
      );
      await page
        .getByRole('button', { name: 'Send message', exact: true })
        .click();
      const action = await actionResponse.promise;
      expect(action.status).toBe(200);
      const { message } = await completedSend(
        page,
        journey.channelId,
        exact,
        requestId,
      );
      const destination = `${path}?sent=${message.id}`;
      expect(action.body.includes(destination)).toBe(true);
      const replay = await page.request.post('/api/messaging/messages', {
        headers: { origin: new URL(page.url()).origin },
        data: {
          version: 1,
          channelId: journey.channelId,
          requestId,
          text: exact,
        },
      });
      expect(replay.status()).toBe(200);
      expect(await replay.json()).toMatchObject({
        id: message.id,
        sequence: message.sequence,
        changeVersion: message.changeVersion,
      });
      expect(await durableMessage(page, journey.channelId, exact)).toEqual(
        message,
      );
      await info.attach('send-completion-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          actionStatus: action.status,
          destination,
          revalidation: action.revalidation ?? null,
          replayStatus: replay.status(),
          messageId: message.id,
          changeVersion: message.changeVersion,
        }),
      });
      // A current-page patch can remove the composer before it consumes the receipt.
      expect(action.revalidation).toBeUndefined();
    } finally {
      await journey.close();
    }
  });
}
