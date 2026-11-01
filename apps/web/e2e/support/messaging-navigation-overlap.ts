import { expect, type Page, type Route, type Browser } from '@playwright/test';
import { test } from './fixtures';
import {
  acceptMessagingJourney,
  openMessagingJourney,
} from './messaging-journey';
import {
  composerRequestId,
  durableMessage,
  oneDurableEdit,
  ownMessageEdit,
} from './messaging-completion';
import { watchChannelObservation } from './channel-observation';
import { effectsRan } from './hydration';

/** Hold actual Next action/RSC responses, after each real server request completes. */
export function holdConversationResponses(
  page: Page,
  channelId: string,
  target: 'editor' | 'history' = 'editor',
  sendResult: 'deliver' | 'lose' = 'deliver',
) {
  const send = Promise.withResolvers<void>();
  const edit = Promise.withResolvers<void>();
  const deliveredSend = Promise.withResolvers<void>();
  const deliveredNavigation = Promise.withResolvers<void>();
  const state = {
    sendReady: false,
    navigationReady: false,
    sends: 0,
    navigations: 0,
    saves: 0,
  };
  const intercept = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = request.headers();
    if (
      url.pathname === `/messages/${channelId}` &&
      request.method() === 'POST' &&
      headers['next-action']
    ) {
      state.sends++;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      state.sendReady = true;
      await send.promise;
      if (sendResult === 'lose') await route.abort('internetdisconnected');
      else await route.fulfill({ response });
      deliveredSend.resolve();
    } else if (
      (target === 'editor'
        ? url.pathname === `/messages/${channelId}/message`
        : url.pathname === `/messages/${channelId}` &&
          url.searchParams.has('before')) &&
      request.method() === 'GET' &&
      headers.rsc === '1' &&
      !headers['next-router-prefetch']
    ) {
      state.navigations++;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      state.navigationReady = true;
      await edit.promise;
      await route.fulfill({ response });
      deliveredNavigation.resolve();
    } else {
      if (
        url.pathname === `/messages/${channelId}/message` &&
        request.method() === 'POST' &&
        headers['next-action']
      )
        state.saves++;
      await route.continue();
    }
  };
  return {
    state,
    intercept,
    releaseSend: async () => {
      send.resolve();
      await deliveredSend.promise;
    },
    releaseNavigation: async () => {
      edit.resolve();
      await deliveredNavigation.promise;
    },
    releaseAll: () => {
      send.resolve();
      edit.resolve();
    },
  };
}

export async function observeConversation(page: Page, channelId: string) {
  const observed = watchChannelObservation(page, channelId);
  await page.reload();
  await observed.ready();
  await effectsRan(page);
  return observed;
}

async function openObservedConversation(
  journey: Awaited<ReturnType<typeof openMessagingJourney>>,
) {
  const page = await acceptMessagingJourney(journey);
  return { page, observed: await observeConversation(page, journey.channelId) };
}

export async function beginHeldSend(
  page: Page,
  held: ReturnType<typeof holdConversationResponses>,
  text: string,
) {
  await page.getByLabel('Your message').fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => held.state.sendReady).toBe(true);
}

type HeldConversation = {
  readonly page: Page;
  readonly channelId: string;
  readonly observed: ReturnType<typeof watchChannelObservation>;
  readonly held: ReturnType<typeof holdConversationResponses>;
};

export async function withHeldConversation(
  browser: Browser,
  sendResult: 'deliver' | 'lose',
  verify: (fixture: HeldConversation) => Promise<void>,
) {
  const journey = await openMessagingJourney(browser);
  let held: ReturnType<typeof holdConversationResponses> | undefined;
  try {
    const { page, observed } = await openObservedConversation(journey);
    held = holdConversationResponses(
      page,
      journey.channelId,
      'editor',
      sendResult,
    );
    await page.route('**/messages/**', held.intercept);
    await verify({ page, observed, held, channelId: journey.channelId });
  } finally {
    held?.releaseAll();
    await journey.close();
  }
}

export function testMessagingNavigationOverlap() {
  for (const first of ['send', 'edit'] as const) {
    test(`newer DM Edit intent survives held send completion with ${first} response first`, async ({
      browser,
    }) => {
      await withHeldConversation(
        browser,
        'deliver',
        async ({ page, observed, held, channelId }) => {
          const requestId = await composerRequestId(page);
          const text = `Overlap contribution ${first}`;
          await beginHeldSend(page, held, text);
          await expect(page.getByLabel('Your message')).toBeDisabled();
          await expect(
            page.getByRole('button', { name: 'Sending…', exact: true }),
          ).toBeDisabled();
          const edit = ownMessageEdit(page, text);
          await expect(edit).toBeVisible();
          const message = await durableMessage(page, channelId, text);
          await observed.heard(message.changeVersion);
          expect(await composerRequestId(page)).toBe(requestId);
          const editorDestination = new URL(
            (await edit.getAttribute('href'))!,
            page.url(),
          ).toString();
          await edit.click();
          await expect.poll(() => held.state.navigationReady).toBe(true);
          // Neither response has reached Next; origin really remains mounted.
          await expect(page.getByLabel('Your message')).toBeDisabled();
          expect(new URL(page.url()).pathname).toBe(`/messages/${channelId}`);
          if (first === 'send') {
            await held.releaseSend();
            // The action has settled in the still-mounted origin before Edit commits.
            await expect(page.getByLabel('Your message')).toBeEnabled();
            await expect(
              page.getByRole('button', { name: 'Sending…', exact: true }),
            ).toHaveCount(0);
            await held.releaseNavigation();
          } else {
            await held.releaseNavigation();
            await expect(page.getByLabel('Revise your message')).toBeVisible();
            await held.releaseSend();
          }
          await expect(page).toHaveURL(editorDestination);
          const editor = page.getByLabel('Revise your message');
          await editor.fill(`Revised overlap ${first}`);
          await page
            .getByRole('button', { name: 'Save message edit', exact: true })
            .click();
          await expect(page).toHaveURL(
            `${new URL(page.url()).origin}/messages/${channelId}`,
          );
          await oneDurableEdit(
            page,
            channelId,
            message,
            `Revised overlap ${first}`,
          );
          expect(held.state.sends).toBe(1);
          expect(held.state.navigations).toBe(1);
          expect(held.state.saves).toBe(1);
        },
      );
    });
  }
}
