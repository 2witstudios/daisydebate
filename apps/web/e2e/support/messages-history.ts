import { expect, test } from './fixtures';
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
} from './messaging-page-locators';

export function testMessagesHistory() {
  test('incoming messages preserve the reader’s position above the newest messages', async ({
    browser,
  }) => {
    const journey = await openMessagingJourney(browser);
    try {
      const page = await acceptMessagingJourney(journey);
      const origin = new URL(page.url()).origin;
      for (let index = 0; index < 35; index++)
        await post(
          journey.sender,
          journey,
          origin,
          `History scroll ${index}: ${'An argument with supporting detail. '.repeat(5)}`,
        );
      await page.goto(`/messages/${journey.channelId}`);
      await effectsRan(page);
      const scroller = pane(page).locator('.message-scroller');
      await scroller.evaluate((node) => {
        node.scrollTop = -400;
      });
      const anchor = await scroller.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        const paragraph = [...node.querySelectorAll('p')].find(
          (item) =>
            item.textContent?.startsWith('History scroll') &&
            item.getBoundingClientRect().top >= bounds.top &&
            item.getBoundingClientRect().bottom <= bounds.bottom,
        );
        if (!paragraph) throw new Error('No visible history anchor');
        return {
          text: paragraph.textContent!,
          top: paragraph.getBoundingClientRect().top,
        };
      });
      await post(
        journey.sender,
        journey,
        origin,
        'A newer line below the reading position',
      );
      await expect(
        pane(page).getByText('A newer line below the reading position', {
          exact: true,
        }),
      ).toHaveCount(1);
      await expect
        .poll(
          async () =>
            (
              await pane(page)
                .getByText(anchor.text, { exact: true })
                .boundingBox()
            )?.y,
        )
        .toBeCloseTo(anchor.top, 0);
    } finally {
      await journey.close();
    }
  });

  test('the New divider stays after reading, and an older first unread offers a jump', async ({
    browser,
  }) => {
    const journey = await openMessagingJourney(browser);
    try {
      const page = await acceptMessagingJourney(journey);
      const origin = new URL(page.url()).origin;
      await post(journey.sender, journey, origin, 'First unread line');
      await page.goto(`/messages/${journey.channelId}`);
      await effectsRan(page);
      const divider = pane(page).getByText('New', { exact: true });
      await expect(divider).toBeVisible();
      await expect(
        list(page).getByRole('link', { name: /, unread$/ }),
      ).toHaveCount(0);
      await composer(page).fill('A reply');
      await page.getByRole('button', { name: 'Send message' }).click();
      await expect(
        pane(page).getByText('A reply', { exact: true }),
      ).toBeVisible();
      await expect(divider).toBeVisible();

      // Reopened with nothing unread, it is gone.
      await page.goto(`/messages/${journey.channelId}`);
      await expect(
        pane(page).getByText('First unread line', { exact: true }),
      ).toBeVisible();
      await expect(divider).toHaveCount(0);

      // Caught up on opening, a message arriving while open is still news.
      await effectsRan(page);
      await post(journey.sender, journey, origin, 'Arrived while open');
      await expect(
        pane(page).getByText('Arrived while open', { exact: true }),
      ).toBeVisible();
      await expect(divider).toBeVisible();

      await page.goto('/messages');
      for (let index = 0; index < 55; index++)
        await post(journey.sender, journey, origin, `Unread line ${index}`);
      await page.goto(`/messages/${journey.channelId}`);
      const jump = page.getByRole('link', { name: 'Jump to first unread' });
      await expect(jump).toBeVisible();
      await expect(divider).toHaveCount(0);
      await effectsRan(page);
      await jump.click();
      await expect(page).toHaveURL(/[?&]unread=\d+/);
      await expect(
        pane(page).getByText('Unread line 0', { exact: true }),
      ).toBeVisible();
      // The latest page already advanced the server's position, so this is the
      // carried boundary, at the actual first unread message.
      await expect(divider).toBeVisible();
      const history = pane(page).getByRole('list', { name: 'Message history' });
      await expect(
        history.getByRole('listitem').filter({ hasText: /^NEW$/i }),
      ).toHaveCount(1);
      await expect(
        history
          .getByRole('listitem')
          .filter({ has: page.locator('#first-unread') })
          .locator('xpath=following-sibling::li[1]'),
      ).toContainText('Unread line 0');
      await expect(
        page.getByRole('link', { name: 'Latest messages' }),
      ).toBeVisible();
    } finally {
      await journey.close();
    }
  });
}
