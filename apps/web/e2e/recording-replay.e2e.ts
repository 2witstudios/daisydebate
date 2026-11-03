import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { createId } from '@paralleldrive/cuid2';
import type { Page } from '@playwright/test';
import { assertNoSeriousFindings } from './support/axe';
import { watchCspViolations } from './support/csp';
import { expect, test } from './support/fixtures';
import { resolveE2EPorts } from '../playwright.config';

/**
 * Replay in a real browser against the production build: the strict CSP, the
 * authorized playlist route, its redirect to a signed read on another origin and
 * hls.js's worker are all live. The media is open-codec because Playwright's
 * Chromium ships no H.264; the worker's H.264 output is proven with real ffmpeg
 * in apps/recording-worker, and in real Chrome and iOS Safari only on staging.
 */
const bucket = `https://localhost:${resolveE2EPorts(process.env).feed}`;

const seed = async (input: Record<string, unknown>): Promise<unknown> => {
  const { stdout } = await promisify(execFile)(
    'bun',
    [
      resolve(import.meta.dirname, 'support/broadcast-seed-process.ts'),
      JSON.stringify(input),
    ],
    {
      cwd: resolve(import.meta.dirname, '../../..'),
      env: process.env,
      timeout: 60_000,
    },
  );
  return JSON.parse(stdout);
};

const seeded: string[] = [];

test.afterEach(async () => {
  await Promise.all(
    seeded.splice(0).map((roundId) => seed({ command: 'stop', roundId })),
  );
});

/** A finished public ranked Round, its video ready and past the spectator timeline. */
const readyRecording = async () => {
  const tag = createId().slice(0, 8);
  const round = (await seed({
    command: 'create',
    mode: 'ranked',
    visibility: 'public',
    title: `Replay ${tag}`,
    resolution: `Resolved ${tag}`,
  })) as { roundId: string; aff: string };
  seeded.push(round.roundId);
  await seed({ command: 'end', roundId: round.roundId });
  const recordingId = (await seed({
    command: 'recording-ready',
    roundId: round.roundId,
  })) as string;
  return { ...round, recordingId };
};

const videoState = (page: Page) =>
  page.locator('video').evaluate((video: HTMLVideoElement) => ({
    time: video.currentTime,
    rate: video.playbackRate,
    width: video.videoWidth,
  }));

test.describe('replaying a Recording with no account', () => {
  test('plays through the authorized route, seeks, changes speed and states its gap', async ({
    page,
  }) => {
    const { roundId, recordingId, aff } = await readyRecording();
    const csp = await watchCspViolations(page);
    const signedReads: string[] = [];
    page.on('request', (request) => {
      if (request.url().startsWith(`${bucket}/recordings-e2e/`))
        signedReads.push(request.url());
    });
    const playlists: string[] = [];
    page.on('response', (response) => {
      if (response.url().includes(`/api/recordings/${recordingId}/playback/`))
        playlists.push(new URL(response.url()).pathname);
    });

    await page.goto(`/recordings/${roundId}`);
    await expect(page.locator('video')).toHaveAttribute(
      'aria-label',
      'Recording of this debate',
    );

    // A replay waits to be asked, unlike a live stream.
    await expect
      .poll(() =>
        page
          .locator('video')
          .evaluate((element: HTMLVideoElement) => element.currentSrc),
      )
      .not.toBe('');
    expect((await videoState(page)).time).toBe(0);

    await page.locator('video').evaluate((element: HTMLVideoElement) => {
      element.muted = true;
      return element.play();
    });
    await expect
      .poll(async () => (await videoState(page)).width)
      .toBeGreaterThan(0);
    await expect
      .poll(async () => (await videoState(page)).time)
      .toBeGreaterThan(0.5);

    await expect(
      page.getByRole('region', { name: 'Missing from this recording' }),
    ).toContainText('0:04 to 0:06: recording stopped and restarted');

    await page.getByLabel('Speed').selectOption('1.5');
    expect((await videoState(page)).rate).toBe(1.5);

    await page
      .locator('video')
      .evaluate((element: HTMLVideoElement) => element.pause());
    await page
      .getByRole('navigation', { name: 'Speech timeline' })
      .getByRole('button', { name: new RegExp(aff) })
      .click();
    await expect
      .poll(async () => Math.abs((await videoState(page)).time - 2))
      .toBeLessThan(0.5);

    expect(playlists).toContain(
      `/api/recordings/${recordingId}/playback/master.m3u8`,
    );
    expect(signedReads.some((url) => url.includes('.m4s'))).toBe(true);
    expect(signedReads.every((url) => url.includes('X-Amz-Signature'))).toBe(
      true,
    );
    expect(
      await page.getByRole('link', { name: 'Download video' }).count(),
    ).toBe(0);
    await assertNoSeriousFindings(page);
    const violations = await csp.read();
    expect(violations.eventViolations).toEqual([]);
    expect(violations.consoleViolations).toEqual([]);
  });

  test('a takedown refuses new playback at once', async ({ page, request }) => {
    const { roundId, recordingId } = await readyRecording();
    const playback = `/api/recordings/${recordingId}/playback/master.m3u8`;
    expect((await request.get(playback)).status()).toBe(200);
    await seed({ command: 'recording-takedown', roundId });
    expect((await request.get(playback)).status()).toBe(404);
    await page.goto(`/recordings/${roundId}`);
    await expect(
      page.getByText('This video is no longer available'),
    ).toBeVisible();
    await expect(page.locator('video')).toHaveCount(0);
  });
});
