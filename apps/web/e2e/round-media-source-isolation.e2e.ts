import type { Page } from '@playwright/test';
import { z } from 'zod';
import { roundMediaStateSchema } from '@daisy/protocol';
import { test, expect } from './support/fixtures';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { closeSettledLaunchContexts } from './support/room-launch-settled';
import {
  MEDIA_POLL,
  grantMedia,
  installMediaCapture,
  openCheckedMediaRound,
  expectConnected,
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
        if (
          location.pathname.startsWith('/rounds/') &&
          video &&
          typeof video === 'object' &&
          video.deviceId
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

const checkedChoices = (page: Page, roomId: string): Promise<unknown> =>
  page.evaluate((roomId) => {
    const entry = Object.entries(sessionStorage).find(([key]) =>
      key.startsWith(`daisy:checked-devices:${roomId}:`),
    );
    return entry ? JSON.parse(entry[1]) : null;
  }, roomId);
