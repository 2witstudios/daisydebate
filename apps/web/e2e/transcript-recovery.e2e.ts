import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { type Page } from '@playwright/test';
import { actualSpeech } from './support/attendance-browser';
import { createHumanBallotRound } from './support/human-ballot-round';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { expect, openPage, test } from './support/fixtures';

const seed = (
  roundId: string,
  from: number,
  count: number,
  close: 'open' | 'partial' = 'open',
) =>
  promisify(execFile)(
    'bun',
    [
      resolve(import.meta.dirname, 'support/transcript-seed-process.ts'),
      roundId,
      String(from),
      String(count),
      close,
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
  const accounts = await createRoomLaunchAccounts(browser, 2);
  const { members } = accounts;
  try {
    const round = await createHumanBallotRound(members, 0);
    // A segment exists once its speech has really begun.
    await actualSpeech(members[0]!.context.request, round.id);
    await seed(round.id, 0, 120);
    const page = await openPage(members[0]!.context, 'transcript recovery');
    await page.goto(`/rounds/${round.id}/room`);
    const transcript = transcriptOf(page);
    const first = transcript.getByText('Fixture line 0.', { exact: false });
    await expect(first).toBeVisible();
    await first.scrollIntoViewIfNeeded();
    await expect(first).toBeInViewport();
    // Reading back stops following; Latest returns to the newest line.
    const latest = page.getByRole('button', { name: 'Latest', exact: true });
    await latest.click();
    await expect(latest).toBeHidden();
    await expect(
      transcript.getByText('Fixture line 119.', { exact: false }),
    ).toBeInViewport();
    await first.scrollIntoViewIfNeeded();

    await page.route(routeOf(round.id), (route) =>
      route.fulfill({ status: 503, body: 'unavailable' }),
    );
    await lookAgain(page);
    await expect(transcript.getByText('Reconnecting')).toBeVisible();
    // Connection never hides evidence: the stream's own state stays beside it.
    await expect(
      transcript.getByRole('status').getByText('Capturing', { exact: true }),
    ).toBeVisible();
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

    // Partial evidence and a lost connection are separate facts, both shown.
    await seed(round.id, 121, 1, 'partial');
    await lookAgain(page);
    const status = transcript.getByRole('status');
    await expect(status.getByText('Partial', { exact: true })).toBeVisible();
    await page.route(routeOf(round.id), (route) =>
      route.fulfill({ status: 503, body: 'unavailable' }),
    );
    await lookAgain(page);
    await expect(status.getByText('Reconnecting')).toBeVisible();
    await expect(status.getByText('Partial', { exact: true })).toBeVisible();
    await page.unroute(routeOf(round.id));

    // A contract this build cannot read asks for a reload, not patience.
    await page.route(routeOf(round.id), (route) =>
      route.fulfill({ json: { added: 'field' } }),
    );
    await lookAgain(page);
    await expect(status.getByRole('button', { name: 'Reload' })).toBeVisible();
    await expect(first).toBeVisible();
    await page.unroute(routeOf(round.id));

    await page.reload();
    await expect(
      transcriptOf(page)
        .getByRole('listitem')
        .filter({ hasText: 'Fixture line' }),
    ).toHaveCount(122);

    await page.route(routeOf(round.id), (route) =>
      route.fulfill({ status: 403, body: 'refused' }),
    );
    await lookAgain(page);
    await expect(transcriptOf(page)).toHaveCount(0);
    await expect(page.getByText('Fixture line 0.')).toHaveCount(0);
  } finally {
    await accounts.closeContexts();
  }
});
