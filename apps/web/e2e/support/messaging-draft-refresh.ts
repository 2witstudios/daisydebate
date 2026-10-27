import { expect } from '@playwright/test';
import { openPage, test } from './fixtures';
import { effectsRan } from './hydration';
import { seedControlMessage, watchChannelBells } from './channel-bells';
import {
  acceptMessagingJourney,
  openMessagingJourney,
} from './messaging-journey';

/**
 * ISSUE-619: a channel doorbell refetches the own-message page. The reader's
 * unsaved edit and its request must survive that refresh; only the bell and
 * the page's own refetch are awaited, never time.
 */
export function testDraftSurvivesRefresh() {
  test('an unsaved message edit and its request survive a live refresh', async ({
    browser,
  }) => {
    const journey = await openMessagingJourney(browser);
    try {
      const page = await acceptMessagingJourney(journey);
      const { channelId } = journey;
      const message = await seedControlMessage(page, channelId, journey.sender);
      const bells = watchChannelBells(page, channelId);
      await page.goto(message.path);
      await effectsRan(page);
      await bells.subscribed();
      const draft = 'An edit still being written';
      const editor = page.getByLabel('Revise your message');
      await editor.fill(draft);
      const form = editor.locator('xpath=ancestor::form');
      const requestId = await form
        .locator('input[name="requestId"]')
        .inputValue();
      const path = new URL(page.url()).pathname;
      const refetched = page.waitForResponse(
        (response) =>
          response.request().headers()['rsc'] === '1' &&
          new URL(response.url()).pathname === path,
      );
      const other = await openPage(journey.sender, 'the doorbell sender');
      await other.goto(`/messages/${channelId}`);
      await other.getByLabel('Your message').fill('A message that rings');
      await other
        .getByRole('button', { name: 'Send message', exact: true })
        .click();
      await bells.heard(message.changeVersion + 1);
      await refetched;
      await expect(editor).toHaveValue(draft);
      await expect(form.locator('input[name="requestId"]')).toHaveValue(
        requestId,
      );
    } finally {
      await journey.close();
    }
  });
}
