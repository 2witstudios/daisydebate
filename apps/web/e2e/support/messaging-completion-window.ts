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

/**
 * Clicks the real Edit Link as the send's answer reaches the DOM. A transition's
 * passive effects run in a later task than its commit, while a MutationObserver
 * callback runs straight after the commit: this click is always between the two.
 */
async function clickEditWhenAnswerCommits(page: Page) {
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      const sending = [...document.querySelectorAll('button')].some(
        (button) => button.textContent === 'Sending…',
      );
      if (sending) return;
      observer.disconnect();
      [...document.querySelectorAll('a')]
        .filter((link) => link.textContent === 'Edit or remove your message')
        .at(-1)
        ?.click();
    });
    observer.observe(document.body, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  });
}

export function testEditCompletionWindow() {
  test('Edit clicked as the send answer commits reaches the editor without a stale send destination', async ({
    browser,
  }) => {
    const journey = await openMessagingJourney(browser);
    try {
      const page = await acceptMessagingJourney(journey);
      const held = holdConversationResponses(page, journey.channelId);
      await page.goto(`/messages/${journey.channelId}`);
      await effectsRan(page);
      await page.route('**/messages/**', held.intercept);
      const text = 'Edit as the answer commits';
      await beginHeldSend(page, held, text);
      await expect(ownMessageEdit(page, text)).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Sending…', exact: true }),
      ).toBeDisabled();
      await clickEditWhenAnswerCommits(page);
      held.releaseAll();
      await expect(page.getByLabel('Revise your message')).toBeVisible();
      await expect(page).toHaveURL(/\/message\?/);
      expect(held.state.sends).toBe(1);
      expect(held.state.routeOrder[0]).toBe('navigation');
      expect(held.state.sentDestinations).toBe(0);
    } finally {
      await journey.close();
    }
  });
}
