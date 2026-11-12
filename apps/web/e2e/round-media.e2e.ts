import {
  roundMediaAdmissionSchema,
  roundMediaStateSchema,
} from '@daisy/protocol';
import { createMediaService } from '@daisy/media';
import { test, expect, openPage } from './support/fixtures';
import { launchLiveKit } from './support/launch-livekit';
import { serverOffsetMs } from './support/round-timing-response';
import { origin } from './support/accounts';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { closeSettledLaunchContexts } from './support/room-launch-settled';
import {
  createHumanBallotRound,
  readBallotRound,
  ballotRoundCommand,
} from './support/human-ballot-round';
import {
  MEDIA_POLL,
  countMediaAdmissions,
  expectPeerCamera,
  grantMedia,
  enableSound,
  installMediaCapture,
} from './support/round-media';

test('actual browser tracks reach an assigned hidden judge and terminal commit stops the local camera', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 4);
  try {
    const round = await createHumanBallotRound(accounts.members);
    const debaters = accounts.members.slice(0, 2);
    await grantMedia(debaters);
    const pages = await Promise.all(
      debaters.map((member, index) =>
        openPage(member.context, `media debater ${index + 1}`),
      ),
    );
    // Controlled alternating audio exercises real LiveKit active-speaker events.
    for (const page of pages) await installMediaCapture(page, 'alternating');
    await Promise.all(
      pages.map((page) => page.goto(`/rounds/${round.id}/room`)),
    );
    for (const page of pages) {
      // Admission may be refused for now under load and retried (ISSUE-494).
      await expect(
        page.getByRole('status').filter({ hasText: /^Connected$/ }),
      ).toBeVisible(MEDIA_POLL);
      await enableSound(page);
      await expectPeerCamera(page);
    }
    const observer = pages[1]!;
    await observer.evaluate(() => {
      const node = document.querySelector<HTMLVideoElement>(
        'video[aria-label="Participant camera"]',
      )!;
      const native = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        'srcObject',
      )!;
      const proof = {
        writes: 0,
        states: [] as string[],
        node,
        stream: node.srcObject,
      };
      Object.defineProperty(node, 'srcObject', {
        get: () => native.get!.call(node),
        set: (value) => {
          proof.writes++;
          native.set!.call(node, value);
        },
      });
      const caption = node.closest('figure')!.querySelector('figcaption')!;
      const record = () => {
        const text = caption.textContent ?? '';
        if (!proof.states.includes(text)) proof.states.push(text);
      };
      new MutationObserver(record).observe(caption, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      record();
      Object.assign(window, { activityProof: proof });
    });
    await expect
      .poll(
        () =>
          observer.evaluate(() => {
            const proof = (
              window as unknown as { activityProof: { states: string[] } }
            ).activityProof;
            return [
              proof.states.some((s) => s.includes('Speaking')),
              proof.states.some((s) => s.includes('Microphone open')),
            ];
          }),
        MEDIA_POLL,
      )
      .toEqual([true, true]);
    expect(
      await observer.evaluate(() => {
        const proof = (
          window as unknown as {
            activityProof: {
              writes: number;
              node: HTMLVideoElement;
              stream: MediaProvider | null;
            };
          }
        ).activityProof;
        return {
          writes: proof.writes,
          sameNode: document.contains(proof.node),
          sameStream: proof.node.srcObject === proof.stream,
          playing: proof.node.videoWidth > 0 && proof.node.readyState >= 2,
        };
      }),
    ).toEqual({ writes: 0, sameNode: true, sameStream: true, playing: true });
    const judge = accounts.members[2]!;
    await judge.context.clearPermissions();
    await judge.context.grantPermissions(['local-network-access'], { origin });
    const judgePage = await openPage(judge.context, 'assigned judge media');
    await judgePage.addInitScript(() => {
      let enabled = false;
      const play = HTMLMediaElement.prototype.play;
      document.addEventListener(
        'click',
        (event) => {
          const target = event.target;
          if (
            target instanceof Element &&
            target.closest('button')?.textContent?.trim() === 'Enable sound'
          )
            enabled = true;
        },
        true,
      );
      HTMLMediaElement.prototype.play = function () {
        if (this instanceof HTMLAudioElement && !enabled)
          return Promise.reject(
            new DOMException('Controlled autoplay refusal', 'NotAllowedError'),
          );
        return play.call(this);
      };
    });
    const admission = judgePage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/rounds/${round.id}/media/session` && response.status() === 200,
    );
    await judgePage.goto(`/rounds/${round.id}/room`);
    const own = roundMediaAdmissionSchema.parse(await (await admission).json());
    expect(own.grants).toEqual({
      publish: [],
      subscribe: true,
      hidden: true,
      capture: false,
    });
    await expect(
      judgePage
        .getByRole('status')
        .filter({ hasText: /^Connected Sound is blocked by your browser/ }),
    ).toBeVisible(MEDIA_POLL);
    await expect(
      judgePage.getByLabel('Your camera', { exact: true }),
    ).toHaveCount(0);
    await expect(judgePage.getByRole('figure')).toHaveCount(2);
    await judgePage
      .getByRole('button', { name: 'Enable sound', exact: true })
      .click();
    await expect(
      judgePage.getByRole('status').filter({ hasText: /^Connected$/ }),
    ).toBeVisible(MEDIA_POLL);
    await expect(
      judgePage.getByRole('button', { name: 'Enable sound', exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(
        () =>
          judgePage
            .getByLabel('Participant camera', { exact: true })
            .evaluateAll(
              (nodes) =>
                nodes.filter((node) => {
                  const video = node as HTMLVideoElement;
                  return video.videoWidth > 0 && video.readyState >= 2;
                }).length,
            ),
        MEDIA_POLL,
      )
      .toBe(2);
    await expect
      .poll(
        () =>
          judgePage
            .getByLabel('Participant audio', { exact: true })
            .evaluateAll((nodes) =>
              nodes.some((node) => {
                const audio = node as HTMLAudioElement;
                const stream = audio.srcObject as MediaStream | null;
                return (
                  !audio.paused &&
                  audio.readyState >= 2 &&
                  stream
                    ?.getAudioTracks()
                    .some((track) => track.readyState === 'live')
                );
              }),
            ),
        MEDIA_POLL,
      )
      .toBe(true);
    for (const member of debaters) {
      const response = await member.context.request.get(
        `/api/rounds/${round.id}/media`,
      );
      expect(response.status()).toBe(200);
      const state = roundMediaStateSchema.parse(await response.json());
      expect(state.peers.some((peer) => peer.identity === own.identity)).toBe(
        false,
      );
    }
    // Hold the camera track itself: LiveKit detaches it from the element's
    // stream once unpublished, so only the track shows it was stopped.
    const local = await pages[0]!
      .getByLabel('Your camera', { exact: true })
      .evaluateHandle(
        (node) =>
          (
            (node as HTMLVideoElement).srcObject as MediaStream
          ).getVideoTracks()[0]!,
      );
    const fresh = await readBallotRound(debaters[0]!.context.request, round.id);
    const seat = fresh.participants.find(
      (participant) =>
        participant.role === 'affirmative' && 'id' in participant,
    );
    if (!seat || !('id' in seat))
      throw new Error('Actual debater seat missing');
    await ballotRoundCommand(debaters[0]!.context.request, fresh, {
      type: 'forfeit',
      participantId: seat.id,
    });
    await expect
      .poll(() => local.evaluate((track) => track.readyState), MEDIA_POLL)
      .toBe('ended');
    await local.dispose();
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('a media read held across a real Round transition is superseded without touching the healthy connection', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 4);
  try {
    const round = await createHumanBallotRound(accounts.members);
    const [speaker, opponent] = accounts.members;
    for (const member of [speaker!, opponent!])
      await member.context.grantPermissions(['camera', 'microphone'], {
        origin,
      });
    const page = await openPage(speaker!.context, 'held read speaker');
    const mediaPath = `/api/rounds/${round.id}/media`;
    const admissions = countMediaAdmissions(page);
    const cancelled: { error: string; ageMs: number }[] = [];
    let heldAt = 0;
    page.on('requestfailed', (request) => {
      // An earlier read superseded while the Round settled is not the held one.
      if (
        heldAt > 0 &&
        new URL(request.url()).pathname === `${mediaPath}/reconcile`
      )
        cancelled.push({
          error: request.failure()?.errorText ?? '',
          ageMs: performance.now() - heldAt,
        });
    });
    await page.goto(`/rounds/${round.id}/room`);
    const status = page.getByRole('status').filter({ hasText: /^Connected$/ });
    await expect(status).toBeVisible(MEDIA_POLL);
    // Maintenance opens the first speech at actual server time.
    await expect
      .poll(async () => {
        const view = await readBallotRound(speaker!.context.request, round.id);
        return view.segments.some(
          (segment) => segment.type === 'speech' && segment.endedAt === null,
        );
      }, MEDIA_POLL)
      .toBe(true);
    const view = await readBallotRound(speaker!.context.request, round.id);
    const seat = view.participants.find(
      (participant) =>
        participant.role === 'affirmative' && 'id' in participant,
    );
    if (!seat || !('id' in seat))
      throw new Error('Actual debater seat missing');
    const caption = page
      .getByRole('figure')
      .filter({ hasText: seat.label })
      .locator('figcaption');
    await expect(caption).toContainText(/Microphone open|Speaking/, MEDIA_POLL);
    const camera = await page
      .getByLabel('Your camera', { exact: true })
      .evaluateHandle(
        (node) =>
          (
            (node as HTMLVideoElement).srcObject as MediaStream
          ).getVideoTracks()[0]!,
      );
    const opponentPage = await openPage(opponent!.context, 'held read peer');
    await opponentPage.goto(`/rounds/${round.id}/room`);
    await expect(
      opponentPage.getByRole('status').filter({ hasText: /^Connected$/ }),
    ).toBeVisible(MEDIA_POLL);
    // Hold the next actual authorized reply. An SDK invalidation asks for it.
    const fetched = Promise.withResolvers<unknown>();
    const release = Promise.withResolvers<void>();
    const delivered = Promise.withResolvers<void>();
    let holding = true;
    await page.route(`**${mediaPath}/reconcile`, async (route) => {
      if (!holding) return route.fallback();
      holding = false;
      heldAt = performance.now();
      const response = await route.fetch();
      fetched.resolve(await response.json());
      await release.promise;
      await route.fulfill({ response }).catch(() => undefined);
      delivered.resolve();
    });
    // The peer leaving is the SDK invalidation that asks for the held read.
    void opponentPage.reload().catch(() => undefined);
    const old = roundMediaStateSchema.parse(await fetched.promise);
    expect(old.grants.publish).toContain('microphone');
    await page.evaluate(() => {
      const proof = { captions: [] as string[], statuses: [] as string[] };
      const record = () => {
        const text = (selector: string) =>
          [...document.querySelectorAll(selector)].map(
            (node) => node.textContent ?? '',
          );
        proof.captions.push(...text('figcaption'));
        proof.statuses.push(...text('[role="status"]'));
      };
      new MutationObserver(record).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      Object.assign(window, { heldReadProof: proof });
    });
    const yielded = await ballotRoundCommand(speaker!.context.request, view, {
      type: 'yield',
      participantId: seat.id,
    });
    expect(yielded.version).toBeGreaterThan(view.version);
    // The age bound keeps this below the held request's 10 s deadline, so only
    // supersession can explain the abort.
    const SUPERSEDED = { timeout: 8_000 };
    await expect.poll(() => cancelled.length, SUPERSEDED).toBe(1);
    expect(cancelled[0]!.error).toContain('ERR_ABORTED');
    expect(cancelled[0]!.ageMs).toBeLessThan(9_000);
    await expect(caption).toContainText('Microphone closed', SUPERSEDED);
    const mark = await page.evaluate(
      () =>
        (window as unknown as { heldReadProof: { captions: string[] } })
          .heldReadProof.captions.length,
    );
    release.resolve();
    await delivered.promise;
    // A further real read proves the late reply did not outlast its successor.
    await opponentPage.reload();
    await expect(caption).toContainText('Microphone closed');
    const proof = await page.evaluate(
      () =>
        (
          window as unknown as {
            heldReadProof: { captions: string[]; statuses: string[] };
          }
        ).heldReadProof,
    );
    // Superseded, the seat stops claiming a state until an answer is current.
    expect(
      proof.captions.some((text) => text.includes('Checking microphone…')),
    ).toBe(true);
    expect(
      proof.captions
        .slice(mark)
        .filter(
          (text) =>
            text.includes(seat.label) && /Microphone open|Speaking/.test(text),
        ),
    ).toEqual([]);
    expect(
      proof.statuses.filter((text) => /Reconnect|Connecting/.test(text)),
    ).toEqual([]);
    await expect(status).toBeVisible();
    expect(admissions()).toBe(1);
    expect(await camera.evaluate((track) => track.readyState)).toBe('live');
    await camera.dispose();
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

// With every browser read held short of the server, only its recovery tick can
// move the floor.
for (const [name, tickOnly] of [
  ['with the peer reading', false],
  ['on the recovery tick alone', true],
] as const)
  test(`a deadline right after a supersession still moves the floor at LiveKit inside 2 s, ${name}`, async ({
    browser,
  }) => {
    // Short enough that the read the new view starts is young at the deadline.
    const COUNTDOWN_MS = 1_000;
    const PERMISSION_BAR_MS = 2_000;
    const accounts = await createRoomLaunchAccounts(browser, 2);
    try {
      const round = await createHumanBallotRound(
        accounts.members,
        0,
        COUNTDOWN_MS,
      );
      const [speaker, opponent] = accounts.members;
      for (const member of [speaker!, opponent!])
        await member.context.grantPermissions(['camera', 'microphone'], {
          origin,
        });
      const now = () => performance.timeOrigin + performance.now();
      const mediaPath = `/api/rounds/${round.id}/media`;
      const page = await openPage(speaker!.context, 'burst speaker');
      await page.goto(`/rounds/${round.id}/room`);
      await expect(
        page.getByRole('status').filter({ hasText: /^Connected$/ }),
      ).toBeVisible(MEDIA_POLL);
      await expect
        .poll(async () => {
          const view = await readBallotRound(
            speaker!.context.request,
            round.id,
          );
          return view.segments.some(
            (segment) => segment.type === 'speech' && segment.endedAt === null,
          );
        }, MEDIA_POLL)
        .toBe(true);

      // This debater's next two reads are held: the first is superseded by the
      // new view, and the second is the young read the boundary lets finish.
      const release = Promise.withResolvers<void>();
      const reads: { startedAt: number; endedAt: number | null }[] = [];
      await page.route(`**${mediaPath}/reconcile`, async (route) => {
        reads.push({ startedAt: now(), endedAt: null });
        if (reads.length > 2 && !tickOnly) return route.fallback();
        if (!tickOnly) await route.fetch();
        await release.promise;
        await route.abort().catch(() => undefined);
      });
      let settledReads = 0;
      page.on('requestfailed', (request) => {
        if (new URL(request.url()).pathname === `${mediaPath}/reconcile`) {
          const read = reads[settledReads++];
          if (read && read.endedAt === null) read.endedAt = now();
        }
      });

      // The peer joining is the SDK invalidation that asks for the first held read.
      const opponentPage = await openPage(opponent!.context, 'burst peer');
      const opponentReads: number[] = [];
      opponentPage.on('request', (request) => {
        if (new URL(request.url()).pathname === `${mediaPath}/reconcile`)
          opponentReads.push(now());
      });
      const admission = opponentPage.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `${mediaPath}/session` &&
          response.ok(),
      );
      await opponentPage.goto(`/rounds/${round.id}/room`);
      const { identity, token } = roundMediaAdmissionSchema.parse(
        await (await admission).json(),
      );
      const roomName = (
        JSON.parse(
          Buffer.from(token.split('.')[1]!, 'base64url').toString(),
        ) as {
          video: { room: string };
        }
      ).video.room;
      await expect(
        opponentPage.getByRole('status').filter({ hasText: /^Connected$/ }),
      ).toBeVisible(MEDIA_POLL);
      await expect.poll(() => reads.length, MEDIA_POLL).toBeGreaterThan(0);

      if (tickOnly)
        await opponentPage.route(`**${mediaPath}/reconcile`, async (route) => {
          await release.promise;
          await route.abort().catch(() => undefined);
        });
      const liveKit = createMediaService({ config: launchLiveKit });
      const opponentGrants = async () =>
        (await liveKit.publicationPermissions(roomName)).find(
          (peer) => peer.identity === identity,
        )?.grants.publish ?? [];
      expect(await opponentGrants()).not.toContain('microphone');

      const view = await readBallotRound(speaker!.context.request, round.id);
      const seat = view.participants.find(
        (participant) =>
          participant.role === 'affirmative' && 'id' in participant,
      );
      if (!seat || !('id' in seat))
        throw new Error('Actual debater seat missing');
      const offset = await serverOffsetMs(
        async () =>
          Number(
            (
              await speaker!.context.request.get(`/api/rounds/${round.id}`)
            ).headers()['x-server-now-ms'],
          ),
        now,
      );
      const yielded = await ballotRoundCommand(speaker!.context.request, view, {
        type: 'yield',
        participantId: seat.id,
      });
      const endedAt = yielded.segments
        .filter((segment) => segment.endedAt !== null)
        .at(-1)?.endedAt;
      if (!endedAt) throw new Error('Actual speech end missing');
      // The yield's reply stamps the server: read the deadline on this clock.
      const deadline = Date.parse(endedAt) + COUNTDOWN_MS - offset;

      await expect
        .poll(opponentGrants, { timeout: 15_000, intervals: [50] })
        .toContain('microphone');
      const grantedAt = now();
      await expect.poll(() => reads.length, MEDIA_POLL).toBeGreaterThan(2);
      const [superseded, young, fresh] = reads;
      release.resolve();

      // The forced shape: the first read went at the view, and the second started
      // before the deadline and was let finish, not aborted at once or left to its
      // 10 s request deadline. The next speech's own view may be what lets it finish
      // instead of the boundary, by the same path; either way the wait is this one.
      expect(superseded!.endedAt).not.toBeNull();
      expect(young!.startedAt).toBeLessThan(deadline);
      expect(fresh!.startedAt).toBeGreaterThan(deadline);
      expect(fresh!.startedAt - young!.startedAt).toBeGreaterThan(1_900);
      expect(fresh!.startedAt - young!.startedAt).toBeLessThan(2_500);
      await test.info().attach('boundary-after-supersession', {
        body: JSON.stringify({
          tickOnly,
          countdownMs: COUNTDOWN_MS,
          youngReadAgeAtDeadlineMs: deadline - young!.startedAt,
          freshReadAfterDeadlineMs: fresh!.startedAt - deadline,
          deadlineToPermissionMs: grantedAt - deadline,
          // Whose read could have moved the floor: reads that reached the server
          // after the deadline and before the permission. Empty means the tick.
          forwardedReadsBeforePermissionMs: (tickOnly
            ? []
            : [...opponentReads, fresh!.startedAt]
          )
            .filter((at) => at > deadline && at < grantedAt)
            .map((at) => at - deadline),
        }),
        contentType: 'application/json',
      });
      // No lower bound: at this countdown the microphone is due the moment the speech
      // ends (roundStartPolicy.microphoneLeadMs, proven in floor-clock.test.ts), and the
      // check before the yield already proves the opponent held no microphone until then.
      expect(grantedAt - deadline).toBeLessThan(PERMISSION_BAR_MS);
    } finally {
      await closeSettledLaunchContexts(accounts);
    }
  });
