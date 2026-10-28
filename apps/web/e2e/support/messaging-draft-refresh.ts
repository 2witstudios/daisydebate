import { expect, type Page } from '@playwright/test';
import { openPage, test } from './fixtures';
import { effectsRan } from './hydration';
import { watchChannelObservation } from './channel-observation';
import {
  acceptMessagingJourney,
  openMessagingJourney,
} from './messaging-journey';

const messageInHistory = (page: Page, text: string) =>
  page
    .getByRole('list', { name: 'Message history' })
    .getByText(text, { exact: true });

/**
 * MSG-5.3-arch1 (ADR 0089): another member's message arrives as an
 * observation snapshot that replaces only the history. The reader's unsent
 * draft and its request survive, and the page is never refetched. Only the
 * snapshot and the rendered message are awaited, never time.
 */
export function testDraftSurvivesRefresh() {
  test('an unsent draft and its request survive another member posting', async ({
    browser,
  }) => {
    const journey = await openMessagingJourney(browser);
    try {
      const page = await acceptMessagingJourney(journey);
      const { channelId } = journey;
      const observed = watchChannelObservation(page, channelId);
      await page.goto(`/messages/${channelId}`);
      await effectsRan(page);
      await observed.ready();
      const path = new URL(page.url()).pathname;
      const refetches: string[] = [];
      page.on('request', (request) => {
        if (
          request.headers()['rsc'] === '1' &&
          new URL(request.url()).pathname === path
        )
          refetches.push(request.url());
      });
      const draft = 'A reply still being written';
      const composer = page.getByLabel('Your message');
      await composer.fill(draft);
      const form = composer.locator('xpath=ancestor::form');
      const requestId = await form
        .locator('input[name="requestId"]')
        .inputValue();
      const other = await openPage(journey.sender, 'the other member');
      await other.goto(`/messages/${channelId}`);
      const text = 'A message that arrives live';
      await other.getByLabel('Your message').fill(text);
      await other
        .getByRole('button', { name: 'Send message', exact: true })
        .click();
      await expect(messageInHistory(page, text)).toHaveCount(1);
      await expect(composer).toHaveValue(draft);
      await expect(form.locator('input[name="requestId"]')).toHaveValue(
        requestId,
      );
      expect(refetches).toEqual([]);
    } finally {
      await journey.close();
    }
  });
}
