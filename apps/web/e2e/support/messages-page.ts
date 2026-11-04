import { testMessagesLayout } from './messages-layout';
import { createId } from '@paralleldrive/cuid2';
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { effectsRan } from './hydration';
import {
  acceptMessagingJourney,
  openMessagingJourney,
} from './messaging-journey';

import { postMessage as post } from './messaging-content-requests';
import {
  conversationPane as pane,
  conversationList as list,
  messageComposer as composer,
  watchMessagingRefetches as watchRefetches,
} from './messaging-page-locators';
import { testMessagesReactions } from './messages-reactions';
import { testMessagesHistory } from './messages-history';

const pageScrolls = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollHeight >
      document.documentElement.clientHeight + 1,
  );

export function testMessagesPage() {
  testMessagesLayout();
  testMessagesReactions();
  testMessagesHistory();
  test('Messages fills the height between the rails, with one pane by route on a phone', async ({
    browser,
  }) => {
    const journey = await openMessagingJourney(browser);
    try {
      const page = await acceptMessagingJourney(journey);
      const origin = new URL(page.url()).origin;
      const { channelId } = journey;
      for (let index = 0; index < 40; index++)
        await post(journey.sender, journey, origin, `Height check ${index}`);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/messages/${channelId}`);
      await expect(composer(page)).toBeVisible();
      await expect(page.locator('main')).toHaveCount(1);
      expect(await pageScrolls(page)).toBe(false);
      const box = await composer(page).boundingBox();
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(900);
      await expect(list(page)).toBeVisible();
      await expect(
        list(page).getByRole('link', { name: journey.senderUsername }),
      ).toHaveAttribute('aria-current', 'page');

      // Whatever the shell puts above the page takes its own height.
      await page.evaluate(() => {
        const bar = document.createElement('div');
        bar.style.height = '120px';
        document.querySelector('main')?.prepend(bar);
      });
      expect(await pageScrolls(page)).toBe(false);
      const below = await composer(page).boundingBox();
      expect((below?.y ?? 0) + (below?.height ?? 0)).toBeLessThanOrEqual(900);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/messages/${channelId}`);
      await expect(composer(page)).toBeVisible();
      await expect(list(page)).toBeHidden();
      await page.getByRole('link', { name: 'Back to messages' }).click();
      await expect(list(page)).toBeVisible();
      await expect(composer(page)).toHaveCount(0);
      await expect(
        page.getByRole('navigation', { name: 'Primary' }).last(),
      ).toBeVisible();
    } finally {
      await journey.close();
    }
  });

  test('a new message updates the list with no refetch, keeping the draft and the conversation', async ({
    browser,
  }) => {
    const journey = await openMessagingJourney(browser);
    try {
      const page = await acceptMessagingJourney(journey);
      const origin = new URL(page.url()).origin;
      await page.goto(`/messages/${journey.channelId}`);
      await effectsRan(page);
      const refetches = watchRefetches(page);
      await composer(page).fill('A draft that stays');
      const text = `A line for the list ${createId()}`;
      await post(journey.sender, journey, origin, text);
      await expect(list(page).getByText(text)).toBeVisible();
      await expect(pane(page).getByText(text, { exact: true })).toBeVisible();
      await expect(composer(page)).toHaveValue('A draft that stays');
      expect(refetches).toEqual([]);
    } finally {
      await journey.close();
    }
  });

  test('the composer sends on Enter, keeps Shift+Enter a new line, and leaves composition alone', async ({
    browser,
  }) => {
    const journey = await openMessagingJourney(browser);
    try {
      const page = await acceptMessagingJourney(journey);
      await page.goto(`/messages/${journey.channelId}`);
      await effectsRan(page);
      await composer(page).click();
      await page.keyboard.type('One');
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type('Two');
      await expect(composer(page)).toHaveValue('One\nTwo');
      await composer(page).evaluate((field) =>
        field.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
            isComposing: true,
          }),
        ),
      );
      await expect(composer(page)).toHaveValue('One\nTwo');
      await page.keyboard.press('Enter');
      await expect(pane(page).getByText(/^One\s+Two$/)).toBeVisible();
      await expect(composer(page)).toHaveValue('');
      await expect(composer(page)).toBeFocused();
    } finally {
      await journey.close();
    }
  });

  for (const javaScriptEnabled of [true, false])
    test(`a conversation search finds what a row shows, JavaScript ${javaScriptEnabled ? 'on' : 'off'}`, async ({
      browser,
    }) => {
      const journey = await openMessagingJourney(browser, javaScriptEnabled);
      try {
        const page = await acceptMessagingJourney(journey);
        const origin = new URL(page.url()).origin;
        const needle = `findable${createId()}`;
        await post(journey.sender, journey, origin, `A line with ${needle}`);
        await page.goto('/messages');
        await page
          .getByRole('searchbox', { name: 'Search conversations' })
          .fill(needle);
        if (javaScriptEnabled)
          await expect(list(page).getByText(needle)).toBeVisible();
        else {
          await page
            .getByRole('searchbox', { name: 'Search conversations' })
            .press('Enter');
          await expect(
            pane(page)
              .getByRole('list', { name: 'Search results' })
              .getByText(needle),
          ).toBeVisible();
        }
        await page
          .getByRole('searchbox', { name: 'Search conversations' })
          .fill(`absent${createId()}`);
        if (javaScriptEnabled)
          await expect(page.getByText('No conversations match.')).toBeVisible();
        else {
          await page
            .getByRole('searchbox', { name: 'Search conversations' })
            .press('Enter');
          await expect(
            pane(page).getByText('No conversations match.'),
          ).toBeVisible();
        }
      } finally {
        await journey.close();
      }
    });
}
