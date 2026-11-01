/**
 * ISSUE-882: a debater's round display must advance from the server's own
 * read-backed sample plus monotonic elapsed time, never from the browser's
 * wall clock. Two humans, no bots, launch a real live Round; the journey
 * then bumps the browser's wall clock two minutes fast and proves the
 * displayed clock against the server's segment rows.
 */
import { origin } from './support/accounts';
import type { Page } from '@playwright/test';
import { expect, openPage, test } from './support/fixtures';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import {
  createProofRoom,
  claim,
  openRoomSetup,
  saveRoundSettings,
} from './support/room-launch-flow';
import { closeSettledLaunchContexts } from './support/room-launch-settled';
import { roundViewSchema, type RoundView } from '@daisy/protocol';

const TWO_MINUTE_SKEW_MS = 120_000;
/** m:ss reads whole seconds; this journey allows one sweep of the clock face. */
const READING_TOLERANCE_MS = 5_000;
/** The launch minute before the first speech opens. */
const WAIT_FOR_ROUND_READ_MS = 60_000;

/* The monotonic instant this process measures: the only honest clock an e2e
   harness may read, since the browser's wall clock is this test's subject. */
const elapsedMs = () => Math.trunc(performance.timeOrigin + performance.now());

/** The m:ss reading of a live round clock ("aria-label": label m:ss). */
const parseClock = (aria: string | null): number => {
  const [reading] = (aria?.split(' ') ?? []).slice(-1);
  if (!reading?.includes(':')) return Number.POSITIVE_INFINITY;
  const [minutes, seconds] = [
    Number(reading.split(':')[0]),
    Number(reading.split(':')[1]),
  ];
  if (!Number.isInteger(minutes) || !Number.isInteger(seconds))
    return Number.POSITIVE_INFINITY;
  return minutes * 60_000 + seconds * 1000;
};

/** The newest stored segment row's remaining duration, from the server's own rows. */
const openSegmentRemaining = (view: RoundView, atMs: number) => {
  const row = view.segments.at(-1);
  if (!row || row.endedAt !== null) return null;
  return Date.parse(row.startedAt) + row.durationMs - atMs;
};

test('a live debater clock reads the server read, not the adjusted browser wall clock', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  let roundId: string | undefined;
  try {
    // Both sides are real humans, so no bot-availability gate is in the way.
    for (const { context } of accounts.members)
      await context.grantPermissions(
        ['camera', 'microphone', 'local-network-access'],
        { origin },
      );
    const host = await openPage(accounts.members[0]!.context, 'skew host');
    const guest = await openPage(accounts.members[1]!.context, 'skew guest');
    const seed = await createProofRoom(host, 'Timing skew proof');
    const settings = await openRoomSetup(host, true);
    for (const segment of seed.rules.segments)
      await settings
        .locator(`[name="duration.segment.${segment.key}"]`)
        .fill('1:00');
    await saveRoundSettings(host);
    await claim(host, seed, 'Affirmative 1');
    await claim(guest, seed, 'Negative 1');
    await host.reload();
    for (const page of [host, guest]) {
      await page
        .getByRole('button', { name: 'Check camera', exact: true })
        .click();
      await expect(page.getByText('✓ Camera', { exact: true })).toBeVisible();
      await page
        .getByRole('button', { name: 'Check microphone', exact: true })
        .click();
      await expect(
        page.getByText('✓ Microphone', { exact: true }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'I’m ready', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: 'Not ready', exact: true }),
      ).toBeEnabled();
    }
    await expect(
      host.getByRole('button', { name: 'Start round', exact: true }),
    ).toBeEnabled();
    await host
      .getByRole('button', { name: 'Start round', exact: true })
      .click();
    await expect(host).toHaveURL(/\/rounds\/[a-z0-9]+\/room$/);
    roundId = new URL(host.url()).pathname.split('/').at(-2)!;
    await expect(guest).toHaveURL(host.url());
    // The Room's start-round admits a frozen scheduled Round; its own host
    // Start command is what begins the speeches (the probe posts the same
    // command over HTTP; this journey presses the real control).
    await expect(
      host.getByRole('button', { name: 'Start round', exact: true }),
    ).toBeEnabled({ timeout: 15_000 });
    await host
      .getByRole('button', { name: 'Start round', exact: true })
      .click();

    const mediaStatus = host
      .getByRole('region', { name: 'Live camera and sound' })
      .getByText('Connected', { exact: true });
    await expect(mediaStatus).toBeVisible({ timeout: 15000 });

    // The assertion: with this session's wall clock shifted two minutes
    // ahead, the display must still read the server's own authority. A raw
    // wall-time display would sit a full two minutes off; the calibrated
    // monotonic projection stays inside the m:ss reading tolerance.
    await host.clock.setSystemTime(elapsedMs() + TWO_MINUTE_SKEW_MS);
    await expect
      .poll(() => displayDeltaMs(host, accounts, roundId!), {
        timeout: WAIT_FOR_ROUND_READ_MS,
      })
      .toBeLessThan(READING_TOLERANCE_MS);

    // The same room, wall clock shifted two minutes BEHIND: an adjustment in
    // the other direction moves nothing on the display either.
    await host.clock.setSystemTime(elapsedMs() - TWO_MINUTE_SKEW_MS);
    await expect
      .poll(() => displayDeltaMs(host, accounts, roundId!), {
        timeout: WAIT_FOR_ROUND_READ_MS,
      })
      .toBeLessThan(READING_TOLERANCE_MS);

    // Delay the actual SSR response after its render seed was generated.
    // The first calibrated read must remove this six-second hydration lag.
    const roomUrl = host.url();
    const mediaAt: number[] = [];
    host.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        request.url().endsWith('/media/reconcile')
      )
        mediaAt.push(elapsedMs());
    });
    await host.route(roomUrl, async (route) => {
      if (!route.request().isNavigationRequest()) return route.continue();
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 6000));
      await route.fulfill({ response });
    });
    await host.reload();
    await host.unrouteAll({ behavior: 'wait' });
    const clockStatus = host.locator('[data-round-time]');
    await expect(clockStatus).toHaveAttribute('data-round-time', 'current');
    await expect(clockStatus).toContainText('±');
    await expect
      .poll(() => displayDeltaMs(host, accounts, roundId!), { timeout: 15000 })
      .toBeLessThan(2000);

    // Delay real authorized action replies beyond the accepted RTT envelope.
    // The resource may be current while its clock evidence is visibly stale.
    let delayed = false;
    await host.route(roomUrl, async (route) => {
      if (
        route.request().method() !== 'POST' ||
        !route.request().headers()['next-action']
      )
        return route.continue();
      const response = await route.fetch();
      const body = await response.text();
      if (body.includes('serverNowMs')) {
        delayed = true;
        await new Promise((resolve) => setTimeout(resolve, 2300));
      }
      await route.fulfill({ response, body });
    });
    await host.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange')),
    );
    await expect.poll(() => delayed).toBe(true);
    await expect(clockStatus).toHaveAttribute('data-round-time', 'stale', {
      timeout: 10000,
    });
    await host.unrouteAll({ behavior: 'wait' });
    await host.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange')),
    );
    await expect(clockStatus).toHaveAttribute('data-round-time', 'current', {
      timeout: 10000,
    });

    // A bounded delayed reply is accepted and its measured RTT is visible.
    await host.route(roomUrl, async (route) => {
      if (
        route.request().method() !== 'POST' ||
        !route.request().headers()['next-action']
      )
        return route.continue();
      const response = await route.fetch();
      const body = await response.text();
      if (body.includes('serverNowMs'))
        await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({ response, body });
    });
    await host.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange')),
    );
    await expect(clockStatus).toContainText(/±[2-9]\d{2} ms/);
    await expect(clockStatus).toHaveAttribute('data-round-time', 'current');
    await expect
      .poll(() => displayDeltaMs(host, accounts, roundId!), { timeout: 15000 })
      .toBeLessThan(2000);
    await host.unrouteAll({ behavior: 'wait' });

    // Freeze the browser renderer, let the real server advance, then resume.
    // Visibility return must obtain fresh evidence, not merely retick the seed.
    const session = await host.context().newCDPSession(host);
    const before = await serverNow(accounts, roundId!);
    await session.send('Page.setWebLifecycleState', { state: 'frozen' });
    await expect
      .poll(async () => (await serverNow(accounts, roundId!)) - before)
      .toBeGreaterThan(3000);
    const resumedRead = host.waitForResponse(
      async (response) =>
        response.request().method() === 'POST' &&
        Boolean(response.request().headers()['next-action']) &&
        (await response.text()).includes('serverNowMs'),
    );
    await session.send('Page.setWebLifecycleState', { state: 'active' });
    await host.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange')),
    );
    await expect(clockStatus).toHaveAttribute('data-round-time', 'current');
    await expect
      .poll(() => displayDeltaMs(host, accounts, roundId!), { timeout: 15000 })
      .toBeLessThan(2000);
    expect((await resumedRead).status()).toBe(200);
    await session.detach();
    await expect(mediaStatus).toBeVisible({ timeout: 15000 });

    // Observe the mounted media session's real reconcile HTTP at the speech
    // boundary after the same-view hydration correction. No media is mocked.
    const response = await accounts.members[0]!.context.request.get(
      `/api/rounds/${roundId}`,
    );
    const view = roundViewSchema.parse(await response.json());
    const segment = view.segments[0]!;
    const deadline = Date.parse(segment.startedAt) + segment.durationMs;
    await expect
      .poll(() => Math.min(...mediaAt.map((at) => Math.abs(at - deadline))), {
        timeout: 70000,
      })
      .toBeLessThan(2000);
    await expect
      .poll(() => displayDeltaMs(host, accounts, roundId!), { timeout: 15000 })
      .toBeLessThan(2000);
    await test.info().attach('round-timing-evidence', {
      body: JSON.stringify({
        candidate: process.env.GIT_COMMIT ?? null,
        cases: [
          'ahead wall skew',
          'reverse wall skew',
          'six-second SSR delay',
          'rejected2300ms RTT with visible stale',
          'accepted400ms reply with visible uncertainty',
          'renderer freeze/resume with fresh authorized read',
          'actual media boundary',
        ],
        clockStatus: await clockStatus.textContent(),
        displayDeltaMs: await displayDeltaMs(host, accounts, roundId!),
        deadlineMs: deadline,
        closestMediaReconcileDeltaMs: Math.min(
          ...mediaAt.map((at) => Math.abs(at - deadline)),
        ),
      }),
      contentType: 'application/json',
    });
    await test.info().attach('round-timing-browser', {
      body: await host.screenshot(),
      contentType: 'image/png',
    });
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

/** |displayed remaining − server-authoritative remaining| at one instant. */
async function displayDeltaMs(
  host: Page,
  accounts: Awaited<ReturnType<typeof createRoomLaunchAccounts>>,
  roundId: string,
): Promise<number> {
  const [aria, body] = await Promise.all([
    host.getByRole('timer').getAttribute('aria-label'),
    accounts.members[0]!.context.request.get(`/api/rounds/${roundId}`),
  ]);
  const displayed = parseClock(aria);
  const latest = openSegmentRemaining(
    roundViewSchema.parse(await body.json()),
    Number(body.headers()['x-server-now-ms']),
  );
  if (displayed === Number.POSITIVE_INFINITY || latest === null)
    return Number.POSITIVE_INFINITY; // keep polling until both are in place
  return Math.abs(displayed - latest);
}

async function serverNow(
  accounts: Awaited<ReturnType<typeof createRoomLaunchAccounts>>,
  roundId: string,
) {
  const response = await accounts.members[0]!.context.request.get(
    `/api/rounds/${roundId}`,
  );
  expect(response.status()).toBe(200);
  const now = Number(response.headers()['x-server-now-ms']);
  expect(Number.isFinite(now)).toBe(true);
  return now;
}
