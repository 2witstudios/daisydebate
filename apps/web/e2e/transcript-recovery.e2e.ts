import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { type Page } from '@playwright/test';
import { createHumanBallotRound } from './support/human-ballot-round';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { expect, openPage, test } from './support/fixtures';

const seed = (roundId: string, from: number, count: number) =>
  promisify(execFile)(
    'bun',
    [
      resolve(import.meta.dirname, 'support/transcript-seed-process.ts'),
      roundId,
      String(from),
      String(count),
    ],
    {
      cwd: resolve(import.meta.dirname, '../../..'),
      env: process.env,
      timeout: 60_000,
    },
  );
const lookAgain = (page: Page) =>
  page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const transcriptOf = (page: Page) =>
  page.locator('[aria-labelledby="live-transcript"]');
const routeOf = (roundId: string) => `**/api/rounds/${roundId}/transcript`;

test('committed transcript survives reads failing and returning, and clears on refusal (ISSUE-885)', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const members = await createRoomLaunchAccounts(browser, 2);
  try {
    const round = await createHumanBallotRound(members, 0);
    await seed(round.id, 0, 120);
    const page = await openPage(members[0]!.context, 'transcript recovery');
    await page.goto(`/rounds/${round.id}/room`);
    const transcript = transcriptOf(page);
    await transcript.getByText('Show the transcript', { exact: true }).click();
    const first = transcript.getByText('Fixture line 0.', { exact: false });
    await expect(first).toBeVisible();
    await first.scrollIntoViewIfNeeded();
    await expect(first).toBeInViewport();

    await page.route(routeOf(round.id), (route) =>
      route.fulfill({ status: 503, body: 'unavailable' }),
    );
    await lookAgain(page);
    await expect(transcript.getByText('Reconnecting')).toBeVisible();
    await expect(first).toBeVisible();

    await seed(round.id, 120, 1);
    await page.unroute(routeOf(round.id));
    const routeRead = page.waitForRequest(
      (request) =>
        request.method() === 'GET' &&
        new URL(request.url()).pathname ===
          `/api/rounds/${round.id}/transcript`,
    );
    await lookAgain(page);
    // A route outlives a build, which a server action does not (CCAP-9).
    await routeRead;
    await expect(
      transcript.getByText('Fixture line 120.', { exact: false }),
    ).toBeVisible();
    await expect(transcript.getByText('Reconnecting')).toBeHidden();
    await expect(first).toBeVisible();

    await page.reload();
    await transcriptOf(page)
      .getByText('Show the transcript', { exact: true })
      .click();
    await expect(transcriptOf(page).getByRole('listitem')).toHaveCount(121);

    await page.route(routeOf(round.id), (route) =>
      route.fulfill({ status: 403, body: 'refused' }),
    );
    await lookAgain(page);
    await expect(transcriptOf(page)).toHaveCount(0);
    await expect(page.getByText('Fixture line 0.')).toHaveCount(0);
  } finally {
    await Promise.all(members.map((member) => member.context.close()));
  }
});
