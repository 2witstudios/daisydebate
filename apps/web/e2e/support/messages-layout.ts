import { createId } from '@paralleldrive/cuid2';
import { closeRoom } from './room-launch-flow';
import { roomViewSchema } from '@daisy/protocol';
import { expect, test } from './fixtures';
import { foundationChoice, humanRoundSelection } from './human-round-selection';
import {
  acceptMessagingJourney,
  openMessagingJourney,
} from './messaging-journey';

/** Real shell chrome above Messages, including the server-rendered native view. */
export function testMessagesLayout() {
  for (const javaScriptEnabled of [true, false])
    test(`Messages fits with an active Room, JavaScript ${javaScriptEnabled ? 'on' : 'off'}`, async ({
      browser,
    }, info) => {
      const journey = await openMessagingJourney(
        browser,
        javaScriptEnabled,
        true,
      );
      let roomId: string | undefined;
      try {
        const page = await acceptMessagingJourney(journey);
        const origin = new URL(page.url()).origin;
        const response = await journey.recipient.request.post('/api/rooms', {
          headers: { origin },
          data: {
            commandId: createId(),
            title: 'Messages layout room',
            resolution: { kind: 'custom', text: 'Cities should fund transit' },
            visibility: 'public',
            selection: humanRoundSelection(foundationChoice, 0),
          },
        });
        expect(response.ok()).toBe(true);
        const room = roomViewSchema.parse((await response.json()).view);
        roomId = room.id;
        for (const width of [1440, 1024, 390]) {
          const height = width === 390 ? 844 : 900;
          await page.setViewportSize({ width, height });
          for (const colorScheme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme });
            await page.goto(`/messages/${journey.channelId}`);
            const bar = page.getByRole('link', {
              name: /^Return to room: Messages layout room/,
            });
            await expect(bar).toBeVisible();
            await expect(bar).toHaveAttribute('href', `/rooms/${room.id}`);
            await expect(page.locator('main')).toHaveCount(1);
            const composer = page.getByRole('textbox', {
              name: 'Your message',
              exact: true,
            });
            await expect(composer).toBeVisible();
            const bounds = await composer.boundingBox();
            expect(bounds).not.toBeNull();
            expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
            expect(
              await page.evaluate(
                () =>
                  document.documentElement.scrollHeight <=
                  document.documentElement.clientHeight + 1,
              ),
            ).toBe(true);
            await expect(
              page.getByRole('region', {
                name: 'Conversation list',
                exact: true,
              }),
            ).toBeVisible({ visible: width >= 901 });
            const path = info.outputPath(
              `messages-${width}-${colorScheme}-${javaScriptEnabled ? 'js' : 'native'}.png`,
            );
            await page.screenshot({ path, fullPage: true });
            await info.attach(`Messages ${width} ${colorScheme}`, {
              path,
              contentType: 'image/png',
            });
          }
        }
        // The reduced viewport left by a phone's on-screen keyboard still fits.
        await page.setViewportSize({ width: 390, height: 320 });
        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollHeight <=
              document.documentElement.clientHeight + 1,
          ),
        ).toBe(true);
        const compactComposer = await page
          .getByRole('textbox', { name: 'Your message', exact: true })
          .boundingBox();
        expect(
          compactComposer!.y + compactComposer!.height,
        ).toBeLessThanOrEqual(320);
      } finally {
        if (roomId) await closeRoom(journey.recipient.request, roomId);
        await journey.close();
      }
    });
}
