import { createId } from '@paralleldrive/cuid2';
import { expect, test, openPage } from './fixtures';
import { effectsRan } from './hydration';
import {
  acceptMessagingJourney,
  openMessagingJourney,
} from './messaging-journey';
import {
  postMessage as post,
  type MessagingJourney as Journey,
} from './messaging-content-requests';

import {
  conversationPane as pane,
  watchMessagingRefetches as watchRefetches,
} from './messaging-page-locators';
import { watchChannelObservation } from './channel-observation';

export function testMessagesReactions() {
  test('another member reacting shows a shared count, and only the reader sees their own', async ({
    browser,
  }) => {
    const journey = await openMessagingJourney(browser);
    try {
      const page = await acceptMessagingJourney(journey);
      const origin = new URL(page.url()).origin;
      const text = `React to this ${createId()}`;
      const sent = await post(journey.recipient, journey, origin, text);
      const messageId = sent.id;
      expect(messageId).toBeTruthy();
      const other = await openPage(journey.sender, 'the other member');
      const observed = watchChannelObservation(other, journey.channelId);
      await other.goto(`/messages/${journey.channelId}`);
      await effectsRan(other);
      await expect(pane(other).getByText(text, { exact: true })).toBeVisible();
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

  test('a live pill removed before its action answer cannot leave a stale own mark', async ({
    browser,
  }) => {
    const journey = await openMessagingJourney(browser);
    let release: (() => void) | undefined;
    try {
      const page = await acceptMessagingJourney(journey);
      const origin = new URL(page.url()).origin;
      const sent = await post(
        journey.recipient,
        journey,
        origin,
        `Reaction race ${createId()}`,
      );
      const messageId = sent.id;
      const toggle = (from: Journey['sender'], active: boolean) =>
        from.request.post('/api/messaging/reactions', {
          headers: { origin },
          data: {
            version: 1,
            channelId: journey.channelId,
            messageId,
            requestId: createId(),
            reaction: '👍',
            active,
          },
        });
      expect((await toggle(journey.recipient, true)).ok()).toBe(true);
      await page.goto(`/messages/${journey.channelId}`);
      await effectsRan(page);
      const held = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      release = resume.resolve;
      const path = `/messages/${journey.channelId}`;
      await page.route(`**${path}`, async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        const response = await route.fetch();
        held.resolve();
        await resume.promise;
        await route.fulfill({ response });
      });
      await page
        .getByRole('button', { name: /^👍 1, you reacted\. Remove$/ })
        .click();
      await held.promise;
      await expect(page.getByRole('button', { name: /^👍 / })).toHaveCount(0);
      const answered = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === path &&
          response.request().method() === 'POST',
      );
      resume.resolve();
      await answered;
      expect((await toggle(journey.sender, true)).ok()).toBe(true);
      await expect(
        page.getByRole('button', { name: /^👍 1\. React$/ }),
      ).toHaveAttribute('aria-pressed', 'false');
    } finally {
      release?.();
      await journey.close();
    }
  });

  for (const view of ['older', 'search'] as const)
    test(`reaction pills use accepted counts on ${view} history`, async ({
      browser,
    }) => {
      const journey = await openMessagingJourney(browser);
      try {
        const page = await acceptMessagingJourney(journey);
        const origin = new URL(page.url()).origin;
        const text = `Reaction count ${createId()}`;
        const sent = await post(journey.recipient, journey, origin, text);
        const messageId = sent.id;
        expect(messageId).toBeTruthy();
        const toggle = async (from: Journey['sender'], active: boolean) => {
          const response = await from.request.post('/api/messaging/reactions', {
            headers: { origin },
            data: {
              version: 1,
              channelId: journey.channelId,
              messageId,
              requestId: createId(),
              reaction: '👍',
              active,
            },
          });
          expect(response.ok()).toBe(true);
        };
        await toggle(journey.sender, true);
        const query =
          view === 'search'
            ? `query=${encodeURIComponent(text)}`
            : `before=${sent.sequence + 1}`;
        await page.goto(`/messages/${journey.channelId}?${query}`);
        await effectsRan(page);
        const refetches = watchRefetches(page);
        await page.getByRole('button', { name: /^👍 1\. React$/ }).click();
        await expect(
          page.getByRole('button', { name: /^👍 2, you reacted\. Remove$/ }),
        ).toBeVisible();
        await page
          .getByRole('button', { name: /^👍 2, you reacted\. Remove$/ })
          .click();
        await expect(
          page.getByRole('button', { name: /^👍 1\. React$/ }),
        ).toBeVisible();
        expect(refetches).toEqual([]);
        await toggle(journey.sender, false);
        await toggle(journey.recipient, true);
        await page.reload();
        await effectsRan(page);
        await page
          .getByRole('button', { name: /^👍 1, you reacted\. Remove$/ })
          .click();
        await expect(page.getByRole('button', { name: /^👍 / })).toHaveCount(0);
      } finally {
        await journey.close();
      }
    });
}
