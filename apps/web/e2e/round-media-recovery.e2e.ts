import { roundMediaStateSchema } from '@daisy/protocol';
import { test, expect, openPage } from './support/fixtures';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { closeSettledLaunchContexts } from './support/room-launch-settled';
import { createHumanBallotRound } from './support/human-ballot-round';
import { MEDIA_POLL, grantMedia, expectConnected } from './support/round-media';

test('direct tabs take over without duplicate capture and reload recovers through prolonged online503', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const round = await createHumanBallotRound(accounts.members, 0);
    const [speaker, listener] = accounts.members;
    if (!speaker || !listener) throw new Error('Two actual members required');
    await grantMedia(accounts.members);
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
    const peerCamera = () =>
      expect
        .poll(
          () =>
            peer
              .getByLabel('Participant camera', { exact: true })
              .evaluateAll((nodes) =>
                nodes.some(
                  (node) =>
                    (node as HTMLVideoElement).videoWidth > 0 &&
                    (node as HTMLVideoElement).readyState >= 2,
                ),
              ),
          MEDIA_POLL,
        )
        .toBe(true);
    await peerCamera();
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
    await peerCamera();
    await heldTrack.dispose();
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
    await peerCamera();
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

test('an actual owner crash wakes a deferred direct tab without storage events', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const round = await createHumanBallotRound(accounts.members, 0);
    const owner = accounts.members[0]!;
    await grantMedia(accounts.members);
    const first = await openPage(owner.context, 'crashing media owner');
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
      // This context deliberately receives no storage notification. A crashed
      // owner cannot send pagehide/release, so only bounded expiry can wake it.
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
    const cdp = await owner.context.newCDPSession(first);
    const crashed = first.waitForEvent('crash');
    void cdp.send('Page.crash').catch(() => undefined);
    await crashed;
    await expectConnected(recovery);
    await expect(
      recovery.getByLabel('Your camera', { exact: true }),
    ).toBeVisible(MEDIA_POLL);
    const response = await owner.context.request.get(
      `/api/rounds/${round.id}/media`,
    );
    expect(response.status()).toBe(200);
    const state = roundMediaStateSchema.parse(await response.json());
    expect(state.state).toBe('ready');
    expect(state.grants.subscribe).toBe(true);
    await recovery.screenshot({
      path: test.info().outputPath('crash-no-event-recovery.png'),
    });
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});
