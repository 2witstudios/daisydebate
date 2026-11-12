/**
 * ISSUE-882: a debater's round display must advance from the server's own
 * read-backed sample plus monotonic elapsed time, never from the browser's
 * wall clock. Two humans, no bots, launch a real live Round; the journey
 * then bumps the browser's wall clock two minutes fast and proves the
 * displayed clock against the server's segment rows.
 */
import { origin } from './support/accounts';
import {
  createClockReadWitness,
  routeStepped,
  serverOffsetMs,
  type RoutedRequest,
  type StepRoute,
} from './support/round-timing-response';
import { expect, openPage, test } from './support/fixtures';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { countMediaAdmissions } from './support/round-media';
import {
  createProofRoom,
  claim,
  openRoomSetup,
  saveRoundSettings,
} from './support/room-launch-flow';
import { closeSettledLaunchContexts } from './support/room-launch-settled';
import { displayDeltaMs } from './support/round-clock';
import { roundMediaStateSchema, roundViewSchema } from '@daisy/protocol';

const TWO_MINUTE_SKEW_MS = 120_000;
/** m:ss reads whole seconds; this journey allows one sweep of the clock face. */
const READING_TOLERANCE_MS = 5_000;
/** The launch minute before the first speech opens. */
const WAIT_FOR_ROUND_READ_MS = 60_000;
/** How far from the deadline the stale read starts: well inside its 10 s budget. */
const STALE_READ_LEAD_MS = 6_000;
/** The boundary bar, against the 43856 ms this journey measured before ISSUE-899. */
const MEDIA_BOUNDARY_BAR_MS = 2_000;

/* The monotonic instant this process measures: the only honest clock an e2e
   harness may read, since the browser's wall clock is this test's subject. */
const elapsedMs = () => Math.trunc(performance.timeOrigin + performance.now());

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
      await expect(
        page.getByText('Camera: ✓ checked', { exact: true }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Check microphone', exact: true })
        .click();
      await expect(
        page.getByText('Microphone: ✓ checked', { exact: true }),
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
      .poll(() => displayDeltaMs(host, accounts.members[0]!, roundId!), {
        timeout: WAIT_FOR_ROUND_READ_MS,
      })
      .toBeLessThan(READING_TOLERANCE_MS);

    // The same room, wall clock shifted two minutes BEHIND: an adjustment in
    // the other direction moves nothing on the display either.
    await host.clock.setSystemTime(elapsedMs() - TWO_MINUTE_SKEW_MS);
    await expect
      .poll(() => displayDeltaMs(host, accounts.members[0]!, roundId!), {
        timeout: WAIT_FOR_ROUND_READ_MS,
      })
      .toBeLessThan(READING_TOLERANCE_MS);

    // One route per request kind owns the rest of the journey; each step swaps
    // its behavior. They are installed once, here, and never removed: replacing
    // routes between steps left requests no handler answered.
    const roomUrl = host.url();
    let delayed = false;
    const delayClockReads =
      (delayMs: number, delivered?: () => void): StepRoute =>
      async (route) => {
        const response = await route.fetch();
        delivered?.();
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        await route.fulfill({ response });
      };
    const documents = await routeStepped(host, roomUrl, (request) =>
      request.isNavigationRequest(),
    );
    const clockReads = await routeStepped(
      host,
      new URL(`/api/rounds/${roundId}`, roomUrl).href,
      (request) => request.method() === 'GET',
    );
    const isServerAction = (request: RoutedRequest) =>
      request.method() === 'POST' && Boolean(request.headers()['next-action']);
    const hostActions = await routeStepped(host, roomUrl, isServerAction);
    const mediaUrl = new URL(`/api/rounds/${roundId}/media`, roomUrl).href;
    const hostMedia = await routeStepped(
      host,
      `${mediaUrl}/reconcile`,
      (request) => request.method() === 'POST',
    );
    const superseded: { at: number; error: string }[] = [];
    const admissions = countMediaAdmissions(host);
    host.on('requestfailed', (request) => {
      if (request.url() === `${mediaUrl}/reconcile`)
        superseded.push({
          at: elapsedMs(),
          error: request.failure()?.errorText ?? '',
        });
    });

    // Delay the actual SSR response after its render seed was generated.
    // The first calibrated read must remove this six-second hydration lag.
    let documentEpoch = 0;
    host.on('domcontentloaded', () => documentEpoch++);
    documents.use(async (route) => {
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 6000));
      await route.fulfill({ response });
    });
    await host.reload();
    await documents.pass();
    const clockStatus = host.locator('[data-round-time]');
    await expect(clockStatus).toHaveAttribute('data-round-time', 'current');
    await expect(clockStatus).toContainText('±');
    await expect
      .poll(() => displayDeltaMs(host, accounts.members[0]!, roundId!), {
        timeout: 15000,
      })
      .toBeLessThan(2000);

    // Delay real authorized clock reads beyond the accepted RTT envelope.
    // The resource may be current while its clock evidence is visibly stale.
    clockReads.use(
      delayClockReads(2300, () => {
        delayed = true;
      }),
    );
    await host.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange')),
    );
    await expect.poll(() => delayed).toBe(true);
    await expect(clockStatus).toHaveAttribute('data-round-time', 'stale', {
      timeout: 10000,
    });
    await clockReads.pass();
    await host.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange')),
    );
    await expect(clockStatus).toHaveAttribute('data-round-time', 'current', {
      timeout: 10000,
    });

    // A bounded delayed reply is fresh evidence. It agrees with the tighter
    // anchor, so it cannot loosen the number on screen or move the display.
    const tightStatus = await clockStatus.textContent();
    let slowReadDelivered = false;
    clockReads.use(
      delayClockReads(400, () => {
        slowReadDelivered = true;
      }),
    );
    await host.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange')),
    );
    await expect.poll(() => slowReadDelivered).toBe(true);
    await clockReads.pass();
    await expect(clockStatus).toHaveAttribute('data-round-time', 'current');
    expect(await clockStatus.textContent()).toBe(tightStatus);
    await expect
      .poll(() => displayDeltaMs(host, accounts.members[0]!, roundId!), {
        timeout: 15000,
      })
      .toBeLessThan(2000);

    // Freeze the browser renderer, let the real server advance, then resume.
    // Visibility return must obtain fresh evidence, not merely retick the seed.
    const witnessClockRead = () => {
      const witness = createClockReadWitness({
        frame: host.mainFrame(),
        documentEpoch: () => documentEpoch,
        now: elapsedMs,
      });
      clockReads.use((route) => witness.handle(route));
      return witness;
    };
    const resumed = witnessClockRead();
    const session = await host.context().newCDPSession(host);
    const before = await serverNow(accounts, roundId!);
    await session.send('Page.setWebLifecycleState', { state: 'frozen' });
    await expect
      .poll(async () => (await serverNow(accounts, roundId!)) - before)
      .toBeGreaterThan(3000);
    resumed.arm();
    await session.send('Page.setWebLifecycleState', { state: 'active' });
    await host.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange')),
    );
    await expect.poll(() => resumed.read(), { timeout: 15000 }).not.toBeNull();
    const resumedRead = resumed.read()!;
    expect(resumedRead.status).toBe(200);
    expect(resumedRead.serverNowMs).toBeGreaterThan(before + 3000);
    await expect(clockStatus).toHaveAttribute('data-round-time', 'current');
    await expect
      .poll(() => displayDeltaMs(host, accounts.members[0]!, roundId!), {
        timeout: 15000,
      })
      .toBeLessThan(2000);
    await clockReads.pass();
    await session.detach();
    await expect(mediaStatus).toBeVisible({ timeout: 15000 });

    // The real caller's media boundary, on the sampled clock. No media is mocked.
    const response = await accounts.members[0]!.context.request.get(
      `/api/rounds/${roundId}`,
    );
    const view = roundViewSchema.parse(await response.json());
    const segment = view.segments[0]!;
    const deadline = Date.parse(segment.startedAt) + segment.durationMs;
    const seat = view.participants.find(
      (participant) => participant.role === 'affirmative',
    );
    if (!seat || !('label' in seat))
      throw new Error('Actual affirmative seat missing');
    const hostMicrophone = host
      .getByRole('figure')
      .filter({ hasText: seat.label })
      .locator('figcaption');
    await expect(hostMicrophone).toContainText(/Microphone open|Speaking/, {
      timeout: 15000,
    });
    const camera = await host
      .getByLabel('Your camera', { exact: true })
      .evaluateHandle(
        (node) =>
          (
            (node as HTMLVideoElement).srcObject as MediaStream
          ).getVideoTracks()[0]!,
      );
    await host.evaluate(() => {
      const statuses: string[] = [];
      new MutationObserver(() => {
        // Only this region's status: clock and Round notices say other things.
        for (const node of document.querySelectorAll(
          '[aria-label="Live camera and sound"] [role="status"]',
        ))
          statuses.push(node.textContent ?? '');
      }).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      Object.assign(window, { boundaryStatuses: statuses });
    });
    const admissionsBefore = admissions();

    // Hold this debater's Server Actions across the boundary, so no newer view
    // can reach its media session. Only the boundary event can then abort a
    // read: a wake never does, and the request's own deadline is 10 s away.
    let releaseActions = () => {};
    const actionsHeld = new Promise<void>((release) => {
      releaseActions = release;
    });
    hostActions.use(async (route) => {
      await actionsHeld;
      await route.fallback();
    });
    // Calibration does not wait on that queue: a stuck action cannot hold it.
    const heldClock = witnessClockRead();
    heldClock.arm();
    await host.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange')),
    );
    await expect
      .poll(() => heldClock.read(), { timeout: 15000 })
      .not.toBeNull();
    expect(heldClock.read()!.serverNowMs).not.toBeNull();
    await clockReads.pass();

    // Start the stale read close enough that its own 10 s request deadline falls
    // well after the boundary. The peer leaving is the SDK invalidation asking;
    // leaving for a blank page commits at once, with no wait on a server render.
    await expect
      .poll(async () => deadline - (await serverNow(accounts, roundId!)), {
        timeout: 60000,
      })
      .toBeLessThan(STALE_READ_LEAD_MS);
    // The deadline on this process's clock, the one every instant here is read on.
    const deadlineHere =
      deadline -
      (await serverOffsetMs(() => serverNow(accounts, roundId!), elapsedMs));
    expect(
      deadlineHere - elapsedMs(),
      'the journey ran out of speech before its boundary',
    ).toBeGreaterThan(2000);
    let staleGrants: readonly string[] | null = null;
    const releaseStale = Promise.withResolvers<void>();
    let staleStartedAt: number | null = null;
    const freshReads: { startedAt: number; microphone: boolean }[] = [];
    superseded.length = 0;
    hostMedia.use(async (route) => {
      const startedAt = elapsedMs();
      if (staleStartedAt === null) {
        staleStartedAt = startedAt;
        const held = await route.fetch();
        staleGrants = roundMediaStateSchema.parse(await held.json()).grants
          .publish;
        await releaseStale.promise;
        await route.abort().catch(() => undefined);
        return;
      }
      const fresh = await route.fetch();
      const state = roundMediaStateSchema.parse(await fresh.json());
      freshReads.push({
        startedAt,
        microphone: state.grants.publish.includes('microphone'),
      });
      await route.fulfill({ response: fresh });
    });
    void guest.goto('about:blank').catch(() => undefined);
    await expect
      .poll(() => staleStartedAt, {
        message: 'the peer leaving should ask for a read before the deadline',
        timeout: deadlineHere - elapsedMs() - 500,
        intervals: [50],
      })
      .not.toBeNull();
    await expect
      .poll(() => staleGrants, {
        message: 'the held read should reach the server before the deadline',
        timeout: deadlineHere - elapsedMs(),
        intervals: [50],
      })
      .toContain('microphone');
    expect(await serverNow(accounts, roundId!)).toBeLessThan(deadline);

    // The boundary: the actual caller supersedes the stale read at the deadline.
    await expect
      .poll(() => superseded.length, {
        timeout: deadlineHere - elapsedMs() + MEDIA_BOUNDARY_BAR_MS,
        intervals: [50],
      })
      .toBeGreaterThan(0);
    const supersededAt = superseded[0]!;
    expect(supersededAt.error).toContain('ERR_ABORTED');
    expect(supersededAt.at - staleStartedAt!).toBeLessThan(9000);
    expect(Math.abs(supersededAt.at - deadlineHere)).toBeLessThan(
      MEDIA_BOUNDARY_BAR_MS,
    );
    // The healthy transition: this debater's closed microphone, on time.
    await expect
      .poll(() => hostMicrophone.textContent(), {
        timeout: deadlineHere - elapsedMs() + MEDIA_BOUNDARY_BAR_MS,
        intervals: [50],
      })
      .toContain('Microphone closed');
    const closedAt = elapsedMs();
    expect(closedAt - deadlineHere).toBeLessThan(MEDIA_BOUNDARY_BAR_MS);
    expect(freshReads.at(0)?.microphone).toBe(false);
    await expect(clockStatus).toHaveAttribute('data-round-time', 'current');

    // The connection held through it. The fence on a late reply is not exercised
    // here, since an aborted fetch cannot deliver one: unit races own that.
    releaseStale.resolve();
    await hostMedia.pass();
    const statuses = await host.evaluate(
      () =>
        (window as unknown as { boundaryStatuses: string[] }).boundaryStatuses,
    );
    expect(
      statuses.filter((text) => /Reconnect|Connecting/.test(text)),
    ).toEqual([]);
    await expect(mediaStatus).toBeVisible();
    expect(admissions()).toBe(admissionsBefore);
    expect(await camera.evaluate((track) => track.readyState)).toBe('live');
    await camera.dispose();
    releaseActions();
    await hostActions.pass();
    await expect
      .poll(() => displayDeltaMs(host, accounts.members[0]!, roundId!), {
        timeout: 15000,
      })
      .toBeLessThan(2000);
    await test.info().attach('round-timing-evidence', {
      body: JSON.stringify({
        cases: [
          'ahead wall skew',
          'reverse wall skew',
          'six-second SSR delay',
          'abandoned read past the RTT envelope with visible stale',
          'agreeing 400ms reply that cannot loosen the anchor',
          'renderer freeze/resume with fresh authorized read',
          'clock read reaches the server while Server Actions are held',
          'real caller boundary supersedes a held read',
          'microphone closes with the connection untouched',
        ],
        clockStatus: await clockStatus.textContent(),
        displayDeltaMs: await displayDeltaMs(
          host,
          accounts.members[0]!,
          roundId!,
        ),
        deadlineMs: deadline,
        staleReadLeadMs: deadlineHere - staleStartedAt!,
        boundaryAbortDeltaMs: supersededAt.at - deadlineHere,
        freshReadDeltaMs: freshReads.at(0)!.startedAt - deadlineHere,
        microphoneClosedDeltaMs: closedAt - deadlineHere,
        e8BaselineDeltaMs: 43856,
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
