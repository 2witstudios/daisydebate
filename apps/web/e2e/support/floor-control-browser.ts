import { openPage } from './fixtures';
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

/**
 * Two real room pages for the floor driver's control Round. Reads stdin once;
 * prints each seat's admitted identity and the room when both are connected,
 * then holds until SIGTERM. Under `held` it drops each page's media reads, as
 * the room-launch proof's tick-only case does. Test-only.
 */
type Input = {
  readonly origin: string;
  readonly roundId: string;
  readonly profile: 'live' | 'held';
  readonly seats: readonly {
    readonly role: 'affirmative' | 'negative';
    readonly cookies: readonly (readonly [string, string])[];
  }[];
};
const input = JSON.parse(readFileSync(0, 'utf8')) as Input;
const browser = await chromium.launch({
  args: [
    '--ignore-certificate-errors',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ],
});
const mediaPath = `/api/rounds/${input.roundId}/media`;
const opened = await Promise.all(
  input.seats.map(async (seat) => {
    const context = await browser.newContext({
      baseURL: input.origin,
      ignoreHTTPSErrors: true,
      permissions: ['camera', 'microphone'],
    });
    await context.addCookies(
      seat.cookies.map(([name, value]) => ({
        name,
        value,
        url: input.origin,
      })),
    );
    const page = await openPage(context, 'floor control seat');
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error')
        problems.push(message.text().slice(0, 300));
    });
    page.on('requestfailed', (request) =>
      problems.push(
        `${new URL(request.url()).pathname}: ${request.failure()?.errorText}`,
      ),
    );
    if (input.profile === 'held')
      await page.route(`**${mediaPath}/reconcile`, (route) => route.abort());
    const admission = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${mediaPath}/session` &&
        response.ok(),
      { timeout: 60_000 },
    );
    await page.goto(`/rounds/${input.roundId}/room`);
    const { identity, token } = (await (await admission).json()) as {
      identity: string;
      token: string;
    };
    await page
      .getByRole('status')
      .filter({ hasText: /^Connected/ })
      .waitFor({ timeout: 60_000 })
      .catch(async (error: unknown) => {
        const statuses = await page.getByRole('status').allTextContents();
        process.stderr.write(
          `${JSON.stringify({ role: seat.role, statuses, problems: problems.slice(-12) })}\n`,
        );
        throw error;
      });
    return { role: seat.role, identity, token };
  }),
);
const claims = JSON.parse(
  Buffer.from(opened[0]!.token.split('.')[1]!, 'base64url').toString(),
) as { video: { room: string } };
process.stdout.write(
  `${JSON.stringify({
    identities: Object.fromEntries(
      opened.map(({ role, identity }) => [role, identity]),
    ),
    roomName: claims.video.room,
  })}\n`,
);
const close = () => {
  void browser.close().finally(() => process.exit(0));
};
process.on('SIGTERM', close);
process.on('SIGINT', close);
