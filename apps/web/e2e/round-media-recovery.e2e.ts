import type { Page } from '@playwright/test';
import { roundMediaStateSchema } from '@daisy/protocol';
import { test, expect, openPage } from './support/fixtures';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { closeSettledLaunchContexts } from './support/room-launch-settled';
import { displayDeltaMs } from './support/round-clock';
import {
  createHumanBallotRound,
  readBallotRound,
} from './support/human-ballot-round';
import {
  MEDIA_POLL,
  countMediaAdmissions,
  grantedDebaters,
  readMediaState,
  grantMedia,
  installMediaCapture,
  expectConnected,
  expectPeerAudio,
  expectPeerCamera,
  openGrantedRound,
} from './support/round-media';

test('direct tabs take over without duplicate capture and reload recovers through prolonged online503', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const { round, speaker, listener } = await grantedDebaters(
      accounts.members,
    );
    const first = await openPage(speaker.context, 'first direct owner');
    const peer = await openPage(listener.context, 'recovery peer');
    await Promise.all([
      first.goto(`/rounds/${round.id}/room`),
      peer.goto(`/rounds/${round.id}/room`),
    ]);
    const connected = (page: typeof first) =>
      expect(
        page.getByRole('status').filter({ hasText: /^Connected/ }),
      ).toBeVisible(MEDIA_POLL);
    await Promise.all([connected(first), connected(peer)]);
    await peer
      .getByRole('button', { name: 'Enable sound', exact: true })
      .click();
    await expectPeerCamera(peer);
    const heldTrack = await first
      .getByLabel('Your camera', { exact: true })
      .evaluateHandle(
        (node) =>
          (
            (node as HTMLVideoElement).srcObject as MediaStream
          ).getVideoTracks()[0]!,
      );
    const second = await openPage(speaker.context, 'direct deferred owner');
    let deferredAdmissions = 0;
    second.on('request', (request) => {
      if (
        new URL(request.url()).pathname ===
        `/api/rounds/${round.id}/media/session`
      )
        deferredAdmissions++;
    });
    await second.goto(`/rounds/${round.id}/room`);
    await expect(
      second.getByText('This Round is open in another tab.', { exact: true }),
    ).toBeVisible();
    await expect(second.getByLabel('Your camera', { exact: true })).toHaveCount(
      0,
    );
    expect(deferredAdmissions).toBe(0);
    await second
      .getByRole('button', { name: 'Use this tab', exact: true })
      .click();
    await connected(second);
    await expect
      .poll(() => heldTrack.evaluate((track) => track.readyState), MEDIA_POLL)
      .toBe('ended');
    await expect(
      first.getByRole('button', { name: 'Use this tab', exact: true }),
    ).toBeVisible();
    await expectPeerCamera(peer);
    await heldTrack.dispose();
    // Reloading the owner keeps its claim ahead of the waiting tab.
    await second.reload();
    await connected(second);
    await expect(second.getByLabel('Your camera', { exact: true })).toBeVisible(
      MEDIA_POLL,
    );
    await expect(
      first.getByRole('button', { name: 'Use this tab', exact: true }),
    ).toBeVisible();
    await expect(first.getByLabel('Your camera', { exact: true })).toHaveCount(
      0,
    );
    // Close the deferred tab; only the active tab remains to recover.
    await first.close();
    let refusals = 0;
    let restoreService!: () => void;
    const serviceRecovered = new Promise<void>((resolve) => {
      restoreService = resolve;
    });
    await second.route(
      `**/api/rounds/${round.id}/media/session`,
      async (route) => {
        if (refusals < 6) {
          refusals++;
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: '{"error":"INFRASTRUCTURE"}',
          });
          if (refusals === 6) restoreService();
        } else await route.continue();
      },
    );
    await second.reload();
    await serviceRecovered;
    await connected(second);
    expect(refusals).toBe(6);
    await expectPeerCamera(peer);
    const stateResponse = await speaker.context.request.get(
      `/api/rounds/${round.id}/media`,
    );
    expect(stateResponse.status()).toBe(200);
    const state = roundMediaStateSchema.parse(await stateResponse.json());
    expect(state.state).toBe('ready');
    expect(state.grants.subscribe).toBe(true);
    const publishedMic = await second
      .getByRole('figure')
      .filter({ has: second.getByLabel('Your camera', { exact: true }) })
      .textContent();
    if (state.grants.publish.includes('microphone'))
      expect(publishedMic).toMatch(/Microphone open|Speaking/);
    else expect(publishedMic).not.toContain('Microphone open');
    await second.screenshot({
      path: test.info().outputPath('recovered-owner.png'),
    });
    for (const entry of ['/', '/lobby']) {
      await second.goto(entry);
      await expect(second).toHaveURL(new RegExp(`/rounds/${round.id}/room$`));
      await connected(second);
    }
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('an owner that dies without releasing wakes a deferred direct tab without storage events', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const round = await createHumanBallotRound(accounts.members, 0);
    const owner = accounts.members[0]!;
    await grantMedia(accounts.members);
    const first = await openPage(owner.context, 'dying media owner');
    await first.addInitScript(() => {
      // A dead document sends no release; a renderer crash in the shared proof
      // browser cost every later journey its camera (run 41371541878).
      window.addEventListener(
        'pagehide',
        (event) => event.stopImmediatePropagation(),
        true,
      );
    });
    await first.goto(`/rounds/${round.id}/room`);
    await expectConnected(first);
    await expect(first.getByLabel('Your camera', { exact: true })).toBeVisible(
      MEDIA_POLL,
    );
    const recovery = await openPage(
      owner.context,
      'no-event deferred recovery',
    );
    await recovery.addInitScript(() => {
      // This context deliberately receives no storage notification, so only
      // bounded expiry of the unreleased claim can wake it.
      window.addEventListener(
        'storage',
        (event) => event.stopImmediatePropagation(),
        true,
      );
    });
    await recovery.goto(`/rounds/${round.id}/room`);
    await expect(
      recovery.getByText('This Round is open in another tab.', { exact: true }),
    ).toBeVisible();
    await expect(
      recovery.getByLabel('Your camera', { exact: true }),
    ).toHaveCount(0);
    await first.close();
    await expectConnected(recovery);
    await expect(
      recovery.getByLabel('Your camera', { exact: true }),
    ).toBeVisible(MEDIA_POLL);
    const state = await readMediaState(owner, round.id);
    expect(state.state).toBe('ready');
    expect(state.grants.subscribe).toBe(true);
    await recovery.screenshot({
      path: test.info().outputPath('dead-owner-no-event-recovery.png'),
    });
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('network loss during a live speech restores peer sound and video without Retry and shows the opponent the drop', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const { round, speaker, listener } = await grantedDebaters(
      accounts.members,
    );
    const source = await openPage(speaker.context, 'offline speaker');
    const peer = await openPage(listener.context, 'watching opponent');
    await installMediaCapture(source, 'alternating');
    await Promise.all([
      source.goto(`/rounds/${round.id}/room`),
      peer.goto(`/rounds/${round.id}/room`),
    ]);
    await Promise.all([expectConnected(source), expectConnected(peer)]);
    await peer
      .getByRole('button', { name: 'Enable sound', exact: true })
      .click();
    await expectPeerCamera(peer);
    await expectPeerAudio(peer);
    const speakerTile = peer.getByRole('figure').first();
    await speaker.context.setOffline(true);
    await expect(
      source.getByRole('status').filter({ hasText: /^Connected/ }),
    ).toHaveCount(0, { timeout: 90_000 });
    await expect(speakerTile).toContainText('Disconnected from media', {
      timeout: 60_000,
    });
    await expect(peer.getByLabel('Participant audio')).toHaveCount(0);
    await speaker.context.setOffline(false);
    await expectConnected(source);
    await expect(speakerTile).not.toContainText('Disconnected from media', {
      timeout: 60_000,
    });
    await expectPeerCamera(peer);
    await expectPeerAudio(peer);
    // After an outage the clock is still on schedule; on a new document it reads afresh.
    const onTimetable = (page: Page, member: typeof speaker) =>
      expect
        .poll(() => displayDeltaMs(page, member, round.id), MEDIA_POLL)
        .toBeLessThan(2_000);
    await onTimetable(source, speaker);
    await source.reload();
    await expectConnected(source);
    await onTimetable(source, speaker);
    const state = await readMediaState(speaker, round.id);
    expect(state.state).toBe('ready');
    expect(state.grants.publish).toEqual(['camera', 'microphone']);
    expect(state.grants.subscribe).toBe(true);
    await peer.screenshot({
      path: test.info().outputPath('peer-after-network-recovery.png'),
    });
    // The timetable moves while the listener is away: only a fresh read can show it.
    await listener.context.setOffline(true);
    await source
      .getByRole('button', { name: 'End speech', exact: true })
      .click();
    await source
      .getByRole('button', { name: 'Confirm end speech', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await readBallotRound(speaker.context.request, round.id)).segments
            .length,
        MEDIA_POLL,
      )
      .toBeGreaterThan(1);
    await listener.context.setOffline(false);
    await onTimetable(peer, listener);
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('every admission stalling is bounded by its deadline, paced, and recovers without Retry', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const { round, page } = await openGrantedRound(
      accounts.members,
      'stalled admission',
    );
    let holding = true;
    let admissions = 0;
    await page.route(
      `**/api/rounds/${round.id}/media/session`,
      async (route) => {
        admissions++;
        // Never answered: only the client's own deadline can end these requests.
        if (!holding) await route.continue();
      },
    );
    await page.goto(`/rounds/${round.id}/room`);
    await expect(
      page.getByRole('status').filter({ hasText: /^Connecting/ }),
    ).toBeVisible();
    // The first join tries four times; after that each attempt is one admission.
    await expect
      .poll(() => admissions, { timeout: 120_000 })
      .toBeGreaterThanOrEqual(6);
    expect(admissions).toBe(6);
    await expect(
      page.getByRole('status').filter({ hasText: /unavailable|Reconnecting/ }),
    ).toBeVisible();
    holding = false;
    await expect(
      page.getByRole('status').filter({ hasText: /^Connected/ }),
    ).toBeVisible({ timeout: 60_000 });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('a media connection that fails after a good admission recovers without Retry', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const { round, page } = await openGrantedRound(
      accounts.members,
      'failed media connection',
    );
    let closed = 0;
    await page.routeWebSocket(/\/rtc/, (socket) => {
      if (closed++ === 0) void socket.close({ code: 1011 });
      else socket.connectToServer();
    });
    await page.goto(`/rounds/${round.id}/room`);
    await expectConnected(page);
    expect(closed).toBeGreaterThanOrEqual(2);
    await expect(
      page.getByRole('button', { name: 'Retry camera and sound', exact: true }),
    ).toHaveCount(0);
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('hung live reads keep media up, say so, and recover on the same connection without Retry', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const { round, speaker, listener } = await grantedDebaters(
      accounts.members,
    );
    const source = await openPage(speaker.context, 'hung reads speaker');
    const admissions = countMediaAdmissions(source);
    await source.goto(`/rounds/${round.id}/room`);
    await expectConnected(source);
    const peer = await openPage(listener.context, 'hung reads peer');
    await peer.goto(`/rounds/${round.id}/room`);
    await expectConnected(peer);
    await expectPeerCamera(source);
    const admitted = admissions();
    let hung = 0;
    await source.route(`**/api/rounds/${round.id}/media/reconcile`, () => {
      // Never answered: only the client's own deadlines can end these reads.
      hung++;
    });
    // Reloading the peer invalidates the source's media state and starts a read.
    await peer.reload();
    await expect(
      source.getByRole('status').filter({ hasText: /out of date/ }),
    ).toBeVisible({ timeout: 90_000 });
    expect(hung).toBeGreaterThanOrEqual(1);
    await expect(source.getByLabel('Your camera', { exact: true })).toBeVisible(
      MEDIA_POLL,
    );
    await expectPeerCamera(source);
    expect(admissions()).toBe(admitted);
    await source.unrouteAll({ behavior: 'ignoreErrors' });
    await expectConnected(source);
    expect(admissions()).toBe(admitted);
    await expectPeerCamera(peer);
    const state = await readMediaState(speaker, round.id);
    expect(state.grants.publish).toEqual(['camera', 'microphone']);
    expect(state.grants.subscribe).toBe(true);
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('a definite refusal stops without capture, retries or a browser-event restart', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const { round, page } = await openGrantedRound(
      accounts.members,
      'refused admission',
    );
    await page.addInitScript(() => {
      const capture = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = (constraints) => {
        document.documentElement.dataset.captured = 'yes';
        return capture(constraints);
      };
    });
    let admissions = 0;
    await page.route(
      `**/api/rounds/${round.id}/media/session`,
      async (route) => {
        admissions++;
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: '{"error":"FORBIDDEN"}',
        });
      },
    );
    await page.goto(`/rounds/${round.id}/room`);
    const refused = page
      .getByRole('status')
      .filter({ hasText: /^Camera and sound were refused/ });
    await expect(refused).toBeVisible(MEDIA_POLL);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(refused).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Retry camera and sound', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel('Your camera', { exact: true })).toHaveCount(
      0,
    );
    expect(admissions).toBe(1);
    expect(
      await page.evaluate(() => document.documentElement.dataset.captured),
    ).toBeUndefined();
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});
