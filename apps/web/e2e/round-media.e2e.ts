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

test('direct tabs take over without duplicate capture and reload recovers through prolonged online503', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const round = await createHumanBallotRound(accounts.members, 0);
    const [speaker, listener] = accounts.members;
    if (!speaker || !listener) throw new Error('Two actual members required');
    for (const member of accounts.members)
      await member.context.grantPermissions(['camera', 'microphone'], {
        origin,
      });
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

test('a camera capture failure after Ready keeps permitted microphone audio reaching the peer', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const round = await createHumanBallotRound(accounts.members, 0);
    const [speaker, listener] = accounts.members;
    if (!speaker || !listener) throw new Error('Two actual members required');
    for (const member of accounts.members)
      await member.context.grantPermissions(['camera', 'microphone'], {
        origin,
      });
    const source = await openPage(speaker.context, 'camera-failed speaker');
    await source.addInitScript(() => {
      const capture = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (constraints?.video)
          throw new DOMException(
            'controlled camera failure',
            'NotReadableError',
          );
        const stream = await capture(constraints);
        if (constraints?.audio) {
          const audio = new AudioContext();
          const tone = audio.createOscillator();
          const gain = audio.createGain();
          const output = audio.createMediaStreamDestination();
          gain.gain.value = 0.2;
          tone.connect(gain).connect(output);
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
    const peer = await openPage(
      listener.context,
      'hearing isolated microphone',
    );
    await Promise.all([
      source.goto(`/rounds/${round.id}/room`),
      peer.goto(`/rounds/${round.id}/room`),
    ]);
    await expect(
      source
        .getByRole('status')
        .filter({ hasText: /Connected.*Your camera could not start/ }),
    ).toBeVisible(MEDIA_POLL);
    await expect(source.getByLabel('Your camera', { exact: true })).toHaveCount(
      0,
    );
    await peer
      .getByRole('button', { name: 'Enable sound', exact: true })
      .click();
    await expect
      .poll(
        () =>
          peer
            .getByLabel('Participant audio', { exact: true })
            .evaluateAll((nodes) =>
              nodes.some((node) => {
                const audio = node as HTMLAudioElement;
                return (
                  !audio.paused &&
                  audio.readyState >= 2 &&
                  (audio.srcObject as MediaStream | null)
                    ?.getAudioTracks()
                    .some((track) => track.readyState === 'live')
                );
              }),
            ),
        MEDIA_POLL,
      )
      .toBe(true);
    const audibleSignal = await peer
      .getByLabel('Participant audio', { exact: true })
      .first()
      .evaluate(async (node) => {
        const stream = (node as HTMLAudioElement).srcObject as MediaStream;
        const audio = new AudioContext();
        await audio.resume();
        const analyser = audio.createAnalyser();
        audio.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        try {
          return await new Promise<boolean>((resolve) => {
            let frames = 0;
            const sample = () => {
              analyser.getFloatTimeDomainData(samples);
              if (samples.some((value) => Math.abs(value) > 0.01))
                resolve(true);
              else if (++frames > 120) resolve(false);
              else requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          });
        } finally {
          await audio.close();
        }
      });
    expect(audibleSignal).toBe(true);
    const response = await speaker.context.request.get(
      `/api/rounds/${round.id}/media`,
    );
    expect(response.status()).toBe(200);
    const state = roundMediaStateSchema.parse(await response.json());
    expect(state.grants.publish).toContain('microphone');
    expect(state.grants.subscribe).toBe(true);
    await source.screenshot({
      path: test.info().outputPath('camera-failed-microphone-live.png'),
    });
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});
