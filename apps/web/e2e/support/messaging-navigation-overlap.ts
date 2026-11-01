import { expect, type Page, type Route } from '@playwright/test';
import { test } from './fixtures';
import {
  acceptMessagingJourney,
  openMessagingJourney,
} from './messaging-journey';
import {
  composerRequestId,
  durableMessages,
  oneDurableEdit,
} from './messaging-completion';
import { watchChannelObservation } from './channel-observation';
import { effectsRan } from './hydration';

/** Hold actual Next action/RSC responses, after each real server request completes. */
function holdResponses(page: Page, channelId: string) {
  const send = Promise.withResolvers<void>();
  const edit = Promise.withResolvers<void>();
  const deliveredSend = Promise.withResolvers<void>();
  const deliveredEdit = Promise.withResolvers<void>();
  const state = {
    sendReady: false,
    editReady: false,
    sends: 0,
    edits: 0,
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
      await route.fulfill({ response });
      deliveredSend.resolve();
    } else if (
      url.pathname === `/messages/${channelId}/message` &&
      request.method() === 'GET' &&
      headers.rsc === '1' &&
      !headers['next-router-prefetch']
    ) {
      state.edits++;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      state.editReady = true;
      await edit.promise;
      await route.fulfill({ response });
      deliveredEdit.resolve();
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
    releaseEdit: async () => {
      edit.resolve();
      await deliveredEdit.promise;
    },
    releaseAll: () => {
      send.resolve();
      edit.resolve();
    },
  };
}

export function testMessagingNavigationOverlap() {
  for (const first of ['send', 'edit'] as const) {
    test(`newer DM Edit intent survives held send completion with ${first} response first`, async ({
      browser,
    }) => {
      const journey = await openMessagingJourney(browser);
      let held: ReturnType<typeof holdResponses> | undefined;
      try {
        const page = await acceptMessagingJourney(journey);
        // Reopen this exact conversation with observation listeners installed.
        const observed = watchChannelObservation(page, journey.channelId);
        await page.reload();
        await observed.ready();
        await effectsRan(page);
        held = holdResponses(page, journey.channelId);
        await page.route('**/messages/**', held.intercept);
        const requestId = await composerRequestId(page);
        const text = `Overlap contribution ${first}`;
        await page.getByLabel('Your message').fill(text);
        await page
          .getByRole('button', { name: 'Send message', exact: true })
          .click();
        await expect.poll(() => held!.state.sendReady).toBe(true);
        await expect(page.getByLabel('Your message')).toBeDisabled();
        await expect(
          page.getByRole('button', { name: 'Sending…', exact: true }),
        ).toBeDisabled();
        const row = page
          .getByRole('list', { name: 'Message history' })
          .getByRole('listitem')
          .filter({ hasText: text });
        const edit = row.getByRole('link', {
          name: 'Edit or remove your message',
          exact: true,
        });
        await expect(edit).toBeVisible();
        const before = await durableMessages(page, journey.channelId);
        const matches = before.messages.filter(
          (message) => !('unavailable' in message) && message.text === text,
        );
        expect(matches).toHaveLength(1);
        const message = matches[0]!;
        await observed.heard(message.changeVersion);
        expect(await composerRequestId(page)).toBe(requestId);
        const editorDestination = new URL(
          (await edit.getAttribute('href'))!,
          page.url(),
        ).toString();
        await edit.click();
        await expect.poll(() => held!.state.editReady).toBe(true);
        // Neither response has reached Next; origin really remains mounted.
        await expect(page.getByLabel('Your message')).toBeDisabled();
        expect(new URL(page.url()).pathname).toBe(
          `/messages/${journey.channelId}`,
        );
        if (first === 'send') {
          await held.releaseSend();
          // The action has settled in the still-mounted origin before Edit commits.
          await expect(page.getByLabel('Your message')).toBeEnabled();
          await expect(
            page.getByRole('button', { name: 'Sending…', exact: true }),
          ).toHaveCount(0);
          await held.releaseEdit();
        } else {
          await held.releaseEdit();
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
          `${new URL(page.url()).origin}/messages/${journey.channelId}`,
        );
        await oneDurableEdit(
          page,
          journey.channelId,
          message,
          `Revised overlap ${first}`,
        );
        expect(held.state.sends).toBe(1);
        expect(held.state.edits).toBe(1);
        expect(held.state.saves).toBe(1);
      } finally {
        held?.releaseAll();
        await journey.close();
      }
    });
  }
}
