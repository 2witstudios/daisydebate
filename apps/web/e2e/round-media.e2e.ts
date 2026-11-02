import {
  roundMediaAdmissionSchema,
  roundMediaStateSchema,
} from '@daisy/protocol';
import { test, expect, openPage } from './support/fixtures';
import { origin } from './support/accounts';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { closeSettledLaunchContexts } from './support/room-launch-settled';
import {
  createHumanBallotRound,
  readBallotRound,
  ballotRoundCommand,
} from './support/human-ballot-round';

/** Real decoded frames over the launch fixture's TLS edge can take seconds to arrive. */
const MEDIA_POLL = { timeout: 20_000 };

test('actual browser tracks reach an assigned hidden judge and terminal commit stops the local camera', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 4);
  try {
    const round = await createHumanBallotRound(accounts.members);
    const debaters = accounts.members.slice(0, 2);
    for (const member of debaters)
      await member.context.grantPermissions(['camera', 'microphone'], {
        origin,
      });
    const pages = await Promise.all(
      debaters.map((member, index) =>
        openPage(member.context, `media debater ${index + 1}`),
      ),
    );
    // Controlled alternating audio exercises real LiveKit active-speaker events.
    for (const page of pages)
      await page.addInitScript(() => {
        const capture = navigator.mediaDevices.getUserMedia.bind(
          navigator.mediaDevices,
        );
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          const stream = await capture(constraints);
          if (constraints?.audio) {
            const audio = new AudioContext();
            const tone = audio.createOscillator();
            const gain = audio.createGain();
            const output = audio.createMediaStreamDestination();
            tone.connect(gain).connect(output);
            for (let i = 0; i < 120; i++) {
              gain.gain.setValueAtTime(0.3, audio.currentTime + i * 2);
              gain.gain.setValueAtTime(0, audio.currentTime + i * 2 + 0.5);
            }
            tone.start();
            await audio.resume();
            for (const track of stream.getAudioTracks()) {
              stream.removeTrack(track);
              track.stop();
            }
            for (const track of output.stream.getAudioTracks())
              stream.addTrack(track);
          }
          return stream;
        };
      });
    await Promise.all(
      pages.map((page) => page.goto(`/rounds/${round.id}/room`)),
    );
    for (const page of pages) {
      // Admission may be refused for now under load and retried (ISSUE-494).
      await expect(
        page.getByRole('status').filter({ hasText: /^Connected$/ }),
      ).toBeVisible(MEDIA_POLL);
      await page
        .getByRole('button', { name: 'Enable sound', exact: true })
        .click();
      await expect
        .poll(
          () =>
            page
              .getByLabel('Participant camera', { exact: true })
              .evaluateAll((nodes) =>
                nodes.some((node) => {
                  const video = node as HTMLVideoElement;
                  return video.videoWidth > 0 && video.readyState >= 2;
                }),
              ),
          MEDIA_POLL,
        )
        .toBe(true);
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
    const judgePage = await openPage(judge.context, 'assigned judge media');
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
      judgePage.getByRole('status').filter({ hasText: /^Connected$/ }),
    ).toBeVisible(MEDIA_POLL);
    await expect(
      judgePage.getByLabel('Your camera', { exact: true }),
    ).toHaveCount(0);
    await expect(judgePage.getByRole('figure')).toHaveCount(2);
    await judgePage
      .getByRole('button', { name: 'Enable sound', exact: true })
      .click();
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
    let admissions = 0;
    const cancelled: { error: string; ageMs: number }[] = [];
    let heldAt = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === `${mediaPath}/session`)
        admissions++;
    });
    page.on('requestfailed', (request) => {
      if (new URL(request.url()).pathname === `${mediaPath}/reconcile`)
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
    const opponentPage = await openPage(opponent!.context, 'held read peer');
    await opponentPage.goto(`/rounds/${round.id}/room`);
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
    expect(admissions).toBe(1);
    expect(await camera.evaluate((track) => track.readyState)).toBe('live');
    await camera.dispose();
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});
