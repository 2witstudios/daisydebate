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
  durableMessages,
} from './messaging-completion';
import {
  holdConversationResponses,
  expectNavigationHeldByPendingSend,
  beginHeldSend,
} from './messaging-navigation-overlap';
import { effectsRan } from './hydration';

export function testMessagingHistoryCompletion() {
  for (const { first, from } of [
    { first: 'send', from: 'page' },
    { first: 'history', from: 'page' },
    { first: 'send', from: 'sent' },
    { first: 'history', from: 'sent' },
  ] as const) {
    test(`Earlier messages keeps one fresh composer after superseded send with ${first} response first from ${from} URL`, async ({
      browser,
    }) => {
      const journey = await openMessagingJourney(browser);
      let held: ReturnType<typeof holdConversationResponses> | undefined;
      try {
        const page = await acceptMessagingJourney(journey);
        // Real authenticated sends. 22 fill more than one 20-row HTTP page; 52 pass
        // the 50-row live window, the only way the live page offers Earlier.
        const rows = from === 'sent' ? 52 : 22;
        for (let index = 0; index < rows; index++) {
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
        if (from === 'sent') {
          // Where every member lands after a send.
          await page.goto(`/messages/${journey.channelId}`);
          await effectsRan(page);
          const landedId = await composerRequestId(page);
          await page.getByLabel('Your message').fill('Landed on sent');
          await page
            .getByRole('button', { name: 'Send message', exact: true })
            .click();
          await completedSend(
            page,
            journey.channelId,
            'Landed on sent',
            landedId,
          );
        } else {
          // Below the live window an explicit HTTP page offers Earlier.
          const { messages } = await durableMessages(page, journey.channelId);
          await page.goto(
            `/messages/${journey.channelId}?before=${messages[0]!.sequence + 1}`,
          );
          await effectsRan(page);
        }
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
        await beginHeldSend(page, held, text);
        const sent = await durableMessage(page, journey.channelId, text);
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
          await held.releaseNavigation();
        } else {
          const origin = page.url();
          await held.releaseNavigation();
          await expectNavigationHeldByPendingSend(page, origin);
          // The unresolved original command still owns its request ID.
          expect(await composerRequestId(page)).toBe(oldId);
          await held.releaseSend();
        }
        // The member's page, not the superseded send's ?sent destination.
        await expect(page).toHaveURL(destination);
        const send = page.getByRole('button', {
          name: 'Send message',
          exact: true,
        });
        await expect(send).toBeEnabled();
        await expect(page).toHaveURL(destination);
        expect(held.state.sentDestinations).toBe(0);
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
        expect(held.state.sentDestinations).toBe(0);
        expect(formPosts).toBe(2);
      } finally {
        held?.releaseAll();
        await journey.close();
      }
    });
  }
}
