import type { Page } from '@playwright/test';
import { z } from 'zod';
import { roundMediaStateSchema } from '@daisy/protocol';
import { test, expect, openPage } from './support/fixtures';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { closeSettledLaunchContexts } from './support/room-launch-settled';
import {
  MEDIA_POLL,
  grantedDebaters,
  readMediaState,
  grantMedia,
  installMediaCapture,
  openCheckedMediaRound,
  expectConnected,
  expectPeerAudio,
  expectPeerCamera,
} from './support/round-media';

test('a camera capture failure after Ready keeps permitted microphone audio reaching the peer', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const [speaker] = accounts.members;
    if (!speaker) throw new Error('Actual speaker required');
    await grantMedia(accounts.members);
    const { round, pages } = await openCheckedMediaRound(
      accounts.members,
      (page, index) =>
        installMediaCapture(
          page,
          index === 0 ? 'camera-failure' : 'alternating',
        ),
    );
    const [source, peer] = pages;
    if (!source || !peer) throw new Error('Actual media pages required');
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
    await expectPeerAudio(peer);
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
    const state = await readMediaState(speaker, round.id);
    expect(state.grants.publish).toContain('microphone');
    expect(state.grants.subscribe).toBe(true);
    await source.screenshot({
      path: test.info().outputPath('camera-failed-microphone-live.png'),
    });
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('a camera prompt nobody answers leaves the microphone publishing and the bar honest', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    await grantMedia(accounts.members);
    const { pages } = await openCheckedMediaRound(
      accounts.members,
      async (page, index) => {
        await installMediaCapture(page, 'alternating');
        if (index !== 0) return;
        await page.addInitScript(() => {
          const capture = navigator.mediaDevices.getUserMedia.bind(
            navigator.mediaDevices,
          );
          navigator.mediaDevices.getUserMedia = (constraints) =>
            location.pathname.startsWith('/rounds/') && constraints?.video
              ? new Promise<MediaStream>(() => undefined)
              : capture(constraints);
        });
      },
    );
    const [source, peer] = pages;
    if (!source || !peer) throw new Error('Actual media pages required');
    await expect(
      source
        .getByRole('status')
        .filter({ hasText: /Your camera is waiting for your browser/ }),
    ).toBeVisible(MEDIA_POLL);
    await expect(source.getByText('Mic live', { exact: true })).toBeVisible(
      MEDIA_POLL,
    );
    await peer
      .getByRole('button', { name: 'Enable sound', exact: true })
      .click();
    await expectPeerAudio(peer);
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('a microphone that dies mid-speech is named, and Retry brings it back to the peer', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    await grantMedia(accounts.members);
    const { pages } = await openCheckedMediaRound(
      accounts.members,
      async (page, index) => {
        // Installed second, so it records the tone track that gets published.
        await installMediaCapture(page, 'alternating');
        if (index === 0)
          await page.addInitScript(() => {
            const held = window as unknown as {
              roundMic?: MediaStreamTrack | undefined;
              micGone?: boolean;
            };
            const capture = navigator.mediaDevices.getUserMedia.bind(
              navigator.mediaDevices,
            );
            navigator.mediaDevices.getUserMedia = async (constraints) => {
              if (held.micGone && constraints?.audio)
                throw new DOMException('controlled unplug', 'NotReadableError');
              const stream = await capture(constraints);
              if (
                constraints?.audio &&
                location.pathname.startsWith('/rounds/')
              )
                held.roundMic = stream.getAudioTracks()[0];
              return stream;
            };
          });
      },
    );
    const [source, peer] = pages;
    if (!source || !peer) throw new Error('Actual media pages required');
    await peer
      .getByRole('button', { name: 'Enable sound', exact: true })
      .click();
    await expect(source.getByText('Mic live', { exact: true })).toBeVisible(
      MEDIA_POLL,
    );
    await expectPeerAudio(peer);
    await source.evaluate(() => {
      const held = window as unknown as {
        roundMic?: MediaStreamTrack | undefined;
        micGone?: boolean;
      };
      held.micGone = true;
      held.roundMic?.stop();
      held.roundMic?.dispatchEvent(new Event('ended'));
    });
    await expect(
      source.getByRole('status').filter({ hasText: /Your microphone/ }),
    ).toBeVisible(MEDIA_POLL);
    await expect(source.getByText('Mic live', { exact: true })).toHaveCount(0);
    await source.evaluate(() => {
      (window as unknown as { micGone?: boolean }).micGone = false;
    });
    await source
      .getByRole('button', { name: 'Retry camera and sound', exact: true })
      .click();
    await expect(source.getByText('Mic live', { exact: true })).toBeVisible(
      MEDIA_POLL,
    );
    await expectPeerAudio(peer);
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('actual checked-device loss retries only the default camera and preserves the microphone choice', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    await grantMedia(accounts.members);
    const { round, pages } = await openCheckedMediaRound(
      accounts.members,
      (page) => installMediaCapture(page, 'alternating'),
    );
    const source = pages[0]!;
    await expectConnected(source);
    const selection = z
      .object({ camera: z.string().min(1), microphone: z.string().min(1) })
      .parse(await checkedChoices(source, round.roomId));
    await source.addInitScript(() => {
      const capture = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = (constraints) => {
        const video = constraints?.video;
        const device =
          video && typeof video === 'object' ? video.deviceId : undefined;
        // Only the checked device is exact; the SDK's default is { ideal: 'default' }.
        if (
          location.pathname.startsWith('/rounds/') &&
          device &&
          typeof device === 'object' &&
          !Array.isArray(device) &&
          device.exact
        )
          return Promise.reject(
            new DOMException(
              'controlled missing checked camera',
              'OverconstrainedError',
            ),
          );
        return capture(constraints);
      };
    });
    let admissions = 0;
    source.on('request', (request) => {
      if (
        new URL(request.url()).pathname ===
        `/api/rounds/${round.id}/media/session`
      )
        admissions++;
    });
    await source.reload();
    await expect(
      source
        .getByRole('status')
        .filter({ hasText: /checked camera is missing/ }),
    ).toBeVisible(MEDIA_POLL);
    await expect(source.getByLabel('Your camera', { exact: true })).toHaveCount(
      0,
    );
    await source
      .getByRole('button', { name: 'Retry camera and sound', exact: true })
      .click();
    await expect(source.getByLabel('Your camera', { exact: true })).toBeVisible(
      MEDIA_POLL,
    );
    await expect(
      source
        .getByRole('status')
        .filter({ hasText: /checked camera is missing/ }),
    ).toHaveCount(0);
    expect(admissions).toBe(1);
    const after = await checkedChoices(source, round.roomId);
    expect(after).toEqual({ microphone: selection.microphone });
    await source.screenshot({
      path: test.info().outputPath('checked-camera-default-recovery.png'),
    });
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

for (const scenario of [
  {
    mode: 'microphone-failure',
    expectedFailure: 'Your microphone could not start.',
    cameraRemains: true,
  },
  {
    mode: 'capture-failure',
    expectedFailure: 'Your camera and microphone could not start.',
    cameraRemains: false,
  },
] as const)
  test(`${scenario.mode} after Ready preserves authorized reception and truthful local capture`, async ({
    browser,
  }) => {
    const accounts = await createRoomLaunchAccounts(browser, 2);
    try {
      await grantMedia(accounts.members);
      let admissions = 0;
      const { round, pages } = await openCheckedMediaRound(
        accounts.members,
        async (page, index) => {
          if (index === 0)
            page.on('request', (request) => {
              if (new URL(request.url()).pathname.endsWith('/media/session'))
                admissions++;
            });
          await installMediaCapture(
            page,
            index === 0 ? scenario.mode : 'alternating',
          );
        },
      );
      const source = pages[0]!;
      await expect(
        source
          .getByRole('status')
          .filter({ hasText: scenario.expectedFailure }),
      ).toBeVisible(MEDIA_POLL);
      await expect(
        source.getByLabel('Your camera', { exact: true }),
      ).toHaveCount(scenario.cameraRemains ? 1 : 0);
      await expect(source.getByText('Mic live', { exact: true })).toHaveCount(
        0,
      );
      await expectPeerCamera(source);
      const response = await accounts.members[0]!.context.request.get(
        `/api/rounds/${round.id}/media`,
      );
      expect(response.status()).toBe(200);
      const authority = roundMediaStateSchema.parse(await response.json());
      expect(authority.grants.publish).toContain('microphone');
      expect(authority.grants.subscribe).toBe(true);
      expect(admissions).toBe(1);
      await source.screenshot({
        path: test.info().outputPath(`${scenario.mode}.png`),
      });
    } finally {
      await closeSettledLaunchContexts(accounts);
    }
  });

const checkedChoices = (page: Page, roomId: string): Promise<unknown> =>
  page.evaluate((roomId) => {
    const entry = Object.entries(sessionStorage).find(([key]) =>
      key.startsWith(`daisy:checked-devices:${roomId}:`),
    );
    return entry ? JSON.parse(entry[1]) : null;
  }, roomId);

test('a renegotiation refused as the floor moves keeps reception, and the next grant publishes one microphone', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const { round, speaker, listener } = await grantedDebaters(
      accounts.members,
    );
    const source = await openPage(speaker.context, 'failed unpublish speaker');
    const peer = await openPage(listener.context, 'failed unpublish peer');
    await source.addInitScript(() => {
      // Run 41493253354: the real SDK absorbs this, so no unpublish rejects here.
      // A rejected unpublish is proved through the transport in media-source-retirement.test.ts.
      const createOffer = RTCPeerConnection.prototype.createOffer as (
        this: RTCPeerConnection,
        options?: RTCOfferOptions,
      ) => Promise<RTCSessionDescriptionInit>;
      let failNext = false;
      const proof = { offerFailed: false };
      Object.assign(window, {
        daisyOfferProof: proof,
        daisyFailNextOffer: () => (failNext = true),
      });
      Object.defineProperty(RTCPeerConnection.prototype, 'createOffer', {
        configurable: true,
        writable: true,
        value(this: RTCPeerConnection, options?: RTCOfferOptions) {
          if (failNext) {
            failNext = false;
            proof.offerFailed = true;
            return Promise.reject(
              new DOMException('refused', 'OperationError'),
            );
          }
          return createOffer.call(this, options);
        },
      });
    });
    await Promise.all(
      [source, peer].map((page) => page.goto(`/rounds/${round.id}/room`)),
    );
    await Promise.all([expectConnected(source), expectConnected(peer)]);
    await expectPeerAudio(peer);
    await source.evaluate(() =>
      (
        window as unknown as { daisyFailNextOffer: () => void }
      ).daisyFailNextOffer(),
    );
    await source
      .getByRole('button', { name: 'End speech', exact: true })
      .click();
    await source
      .getByRole('button', { name: 'Confirm end speech', exact: true })
      .click();
    await expect
      .poll(
        () =>
          source.evaluate(
            () =>
              (
                window as unknown as {
                  daisyOfferProof: { offerFailed: boolean };
                }
              ).daisyOfferProof.offerFailed,
          ),
        MEDIA_POLL,
      )
      .toBe(true);
    await expectConnected(source);
    await expectPeerCamera(source);
    // The negative's speech follows at once; ending it returns the floor here.
    await peer.getByRole('button', { name: 'End speech', exact: true }).click();
    await peer
      .getByRole('button', { name: 'Confirm end speech', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await readMediaState(speaker, round.id)).grants.publish.includes(
            'microphone',
          ),
        { timeout: 90_000 },
      )
      .toBe(true);
    await expectPeerAudio(peer);
    await expect(
      peer.getByLabel('Participant audio', { exact: true }),
    ).toHaveCount(1);
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});
