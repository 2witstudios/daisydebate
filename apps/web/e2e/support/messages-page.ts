import { createId } from '@paralleldrive/cuid2';
import { expect, type Page } from '@playwright/test';
import { openPage, test } from './fixtures';
import { effectsRan } from './hydration';
import { watchChannelObservation } from './channel-observation';
import {
  acceptMessagingJourney,
  openMessagingJourney,
} from './messaging-journey';

type Journey = Awaited<ReturnType<typeof openMessagingJourney>>;

const post = async (
  from: Journey['sender'],
  journey: Journey,
  origin: string,
  text: string,
) => {
  const response = await from.request.post('/api/messaging/messages', {
    headers: { origin },
    data: {
      version: 1,
      channelId: journey.channelId,
      requestId: createId(),
      text,
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { message?: { id?: string } };
};

const list = (page: Page) =>
  page.getByRole('list', { name: 'Conversations', exact: true });
const pane = (page: Page) =>
  page.getByRole('region', { name: 'Conversation', exact: true });
const composer = (page: Page) =>
  page.getByRole('textbox', { name: 'Your message', exact: true });

const pageScrolls = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollHeight >
      document.documentElement.clientHeight + 1,
  );

/** Everything the page asked the app router for: an RSC refetch. */
const watchRefetches = (page: Page) => {
  const refetches: string[] = [];
  page.on('request', (request) => {
    if (request.headers().rsc !== undefined) refetches.push(request.url());
  });
  return refetches;
};

export function testMessagesPage() {
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

  test('another member reacting shows a shared count, and only the reader sees their own', async ({
    browser,
  }) => {
    const journey = await openMessagingJourney(browser);
    try {
      const page = await acceptMessagingJourney(journey);
      const origin = new URL(page.url()).origin;
      const text = `React to this ${createId()}`;
      const sent = await post(journey.recipient, journey, origin, text);
      const messageId = sent.message?.id;
      expect(messageId).toBeTruthy();
      const other = await openPage(journey.sender, 'the other member');
      const observed = watchChannelObservation(other, journey.channelId);
      await other.goto(`/messages/${journey.channelId}`);
      await effectsRan(other);
      await expect(other.getByText(text, { exact: true })).toBeVisible();
      const refetches = watchRefetches(other);
      const reacted = await journey.recipient.request.post(
        '/api/messaging/reactions',
        {
          headers: { origin },
          data: {
            version: 1,
            channelId: journey.channelId,
            messageId,
            requestId: createId(),
            reaction: '👍',
            active: true,
          },
        },
      );
      expect(reacted.status()).toBe(200);
      const pill = other.getByRole('button', { name: /^👍 1\. React$/ });
      await expect(pill).toBeVisible();
      await expect(pill).toHaveAttribute('aria-pressed', 'false');
      expect(refetches).toEqual([]);
      expect(
        JSON.stringify(observed.snapshots()).match(/"own"|reactorActorId/),
      ).toBeNull();

      // Their own mark comes from their own read, and survives none of the other's.
      await page.goto(`/messages/${journey.channelId}`);
      await expect(
        page.getByRole('button', { name: /^👍 1, you reacted\. Remove$/ }),
      ).toHaveAttribute('aria-pressed', 'true');
      await other.getByRole('button', { name: /^👍 1\. React$/ }).click();
      await expect(
        other.getByRole('button', { name: /^👍 2, you reacted\. Remove$/ }),
      ).toHaveAttribute('aria-pressed', 'true');
      expect(refetches).toEqual([]);
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

      for (let index = 0; index < 55; index++)
        await post(journey.sender, journey, origin, `Unread line ${index}`);
      await page.goto(`/messages/${journey.channelId}`);
      const jump = page.getByRole('link', { name: 'Jump to first unread' });
      await expect(jump).toBeVisible();
      await expect(divider).toHaveCount(0);
      await jump.click();
      await expect(
        pane(page).getByText('Unread line 0', { exact: true }),
      ).toBeVisible();
      await expect(divider).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Latest messages' }),
      ).toBeVisible();
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
      await expect(pane(page).getByText(/^One\sTwo$/)).toBeVisible();
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
            pane(page).getByRole('list', { name: 'Search results' }).getByText(needle),
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
          await expect(pane(page).getByText('No conversations match.')).toBeVisible();
        }
      } finally {
        await journey.close();
      }
    });
}
