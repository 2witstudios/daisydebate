import { createId } from '@paralleldrive/cuid2';
import { expect } from '@playwright/test';
import { test } from './fixtures';
import {
  acceptMessagingJourney,
  openMessagingJourney,
} from './messaging-journey';
import {
  composerRequestId,
  completedSend,
  durableMessage,
} from './messaging-completion';
import { holdConversationResponses } from './messaging-navigation-overlap';
import { watchChannelObservation } from './channel-observation';
import { effectsRan } from './hydration';

export function testMessagingHistoryCompletion() {
  for (const first of ['send', 'history'] as const) {
    test(`Earlier messages keeps one fresh composer after superseded send with ${first} response first`, async ({
      browser,
    }) => {
      const journey = await openMessagingJourney(browser);
      let held: ReturnType<typeof holdConversationResponses> | undefined;
      try {
        const page = await acceptMessagingJourney(journey);
        // Real authenticated setup: 11 sends per actor remain below the fixture's
        // 20/min budget and make the actual 20-row history expose Earlier messages.
        for (let index = 0; index < 22; index++) {
          const member = index % 2 === 0 ? journey.sender : journey.recipient;
          const response = await member.request.post(
            '/api/messaging/messages',
            {
              headers: { origin: new URL(page.url()).origin },
              data: {
                version: 1,
                channelId: journey.channelId,
                requestId: createId(),
                text: `Earlier history setup ${index}`,
              },
            },
          );
          expect(response.status()).toBe(200);
        }
        const observed = watchChannelObservation(page, journey.channelId);
        await page.reload();
        await observed.ready();
        await effectsRan(page);
        await expect(
          page.getByRole('link', { name: 'Earlier messages', exact: true }),
        ).toBeVisible();
        held = holdConversationResponses(page, journey.channelId, 'history');
        await page.route('**/messages/**', held.intercept);
        let formPosts = 0;
        page.on('request', (request) => {
          if (
            request.method() === 'POST' &&
            request.headers()['next-action'] &&
            new URL(request.url()).pathname === `/messages/${journey.channelId}`
          )
            formPosts++;
        });
        const oldId = await composerRequestId(page);
        const text = `Send before Earlier messages ${first}`;
        await page.getByLabel('Your message').fill(text);
        await page
          .getByRole('button', { name: 'Send message', exact: true })
          .click();
        await expect.poll(() => held!.state.sendReady).toBe(true);
        const sent = await durableMessage(page, journey.channelId, text);
        await observed.heard(sent.changeVersion);
        await expect(page.getByLabel('Your message')).toBeDisabled();
        const earlier = page.getByRole('link', {
          name: 'Earlier messages',
          exact: true,
        });
        const destination = new URL(
          (await earlier.getAttribute('href'))!,
          page.url(),
        ).toString();
        await earlier.click();
        await expect.poll(() => held!.state.navigationReady).toBe(true);
        await expect(page.getByLabel('Your message')).toBeDisabled();
        if (first === 'send') {
          await held.releaseSend();
          await expect(page.getByLabel('Your message')).toBeEnabled();
          await held.releaseNavigation();
        } else {
          await held.releaseNavigation();
          await expect(page).toHaveURL(destination);
          // New server props have committed, but the unresolved original command owns its ID.
          expect(await composerRequestId(page)).toBe(oldId);
          await expect(page.getByLabel('Your message')).toBeDisabled();
          await held.releaseSend();
        }
        await expect(page).toHaveURL(destination);
        const send = page.getByRole('button', {
          name: 'Send message',
          exact: true,
        });
        await expect(send).toBeEnabled();
        await expect(page.getByLabel('Your message')).toHaveValue('');
        const freshId = await composerRequestId(page);
        expect(freshId).not.toBe(oldId);
        await page.getByLabel('Your message').fill('NEW');
        await expect(send).toBeEnabled();
        // Only hold the first send; the second is an ordinary real Next completion.
        await page.unroute('**/messages/**', held.intercept);
        await send.click();
        const next = await completedSend(
          page,
          journey.channelId,
          'NEW',
          freshId,
        );
        expect(next.message.id).not.toBe(sent.id);
        const original = await durableMessage(page, journey.channelId, text);
        expect(original.changeVersion).toBe(sent.changeVersion);
        expect(held.state.sends).toBe(1);
        expect(held.state.navigations).toBe(1);
        expect(formPosts).toBe(2);
      } finally {
        held?.releaseAll();
        await journey.close();
      }
    });
  }
}
