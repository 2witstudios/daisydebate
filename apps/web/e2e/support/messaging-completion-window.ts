import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { effectsRan } from './hydration';
import {
  acceptMessagingJourney,
  openMessagingJourney,
} from './messaging-journey';
import { ownMessageEdit } from './messaging-completion';
import {
  beginHeldSend,
  holdConversationResponses,
} from './messaging-navigation-overlap';

/** Clicks Edit this long after the send response body arrives, via the real Link. */
async function clickEditAfterSendResponse(page: Page, delayMs: number) {
  await page.evaluate((delay) => {
    const real = window.fetch;
    window.fetch = (async (...args: Parameters<typeof fetch>) => {
      const response = await real(...args);
      if (new Headers(args[1]?.headers).has('next-action'))
        void response
          .clone()
          .text()
          .then(() =>
            setTimeout(() => {
              [...document.querySelectorAll('a')]
                .filter(
                  (link) => link.textContent === 'Edit or remove your message',
                )
                .at(-1)
                ?.click();
            }, delay),
          );
      return response;
    }) as typeof window.fetch;
  }, delayMs);
}

async function clickInsideCompletion(
  page: Page,
  channelId: string,
  delayMs: number,
  text: string,
) {
  const held = holdConversationResponses(page, channelId);
  await page.goto(`/messages/${channelId}`);
  await effectsRan(page);
  await page.route('**/messages/**', held.intercept);
  await clickEditAfterSendResponse(page, delayMs);
  await beginHeldSend(page, held, text);
  await expect(ownMessageEdit(page, text)).toBeVisible();
  held.releaseAll();
  await expect(page.getByLabel('Revise your message')).toBeVisible();
  await expect(page).toHaveURL(/\/message\?/);
  // A send destination issued before the click is preempted by Next; one issued
  // after the member's Edit is the stale completion this slice forbids.
  expect(held.state.routeOrder.join('>')).not.toContain('navigation>sent');
  await page.unroute('**/messages/**', held.intercept);
}

export function testEditCompletionWindow() {
  // The click must land after the action settles and before its answer commits, a
  // window of a few milliseconds whose position varies by machine, so this samples
  // it. Green can never be a timing accident; red depends on landing in the window.
  test('Edit clicked inside the send completion window reaches the editor', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const journey = await openMessagingJourney(browser);
    try {
      const page = await acceptMessagingJourney(journey);
      const delays = [1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6];
      for (const [index, delayMs] of delays.entries())
        await clickInsideCompletion(
          page,
          journey.channelId,
          delayMs,
          `Completion window ${index}`,
        );
    } finally {
      await journey.close();
    }
  });
}
