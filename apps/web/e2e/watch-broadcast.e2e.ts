import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { createId } from '@paralleldrive/cuid2';
import type { APIRequestContext, Page } from '@playwright/test';
import { assertNoSeriousFindings } from './support/axe';
import { watchCspViolations } from './support/csp';
import { expect, openPage, test } from './support/fixtures';
import { resolveE2EPorts } from '../playwright.config';

/**
 * The anonymous viewer, in a real browser against the production build: the
 * strict CSP, hls.js's blob worker and a feed on another origin are all live.
 * A CSP block is what unit tests cannot see.
 */
const feed = `https://localhost:${resolveE2EPorts(process.env).feed}`;

type Seeded = {
  readonly roundId: string;
  readonly broadcastId: string;
  readonly aff: string;
  readonly caption: string;
};

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

const liveRound = async (
  over: Partial<{
    mode: 'ranked' | 'casual';
    visibility: 'public' | 'unlisted' | 'private';
  }> = {},
): Promise<Seeded> => {
  const tag = createId().slice(0, 8);
  const round = (await seed({
    command: 'create',
    mode: 'ranked',
    visibility: 'public',
    title: `Room ${tag}`,
    resolution: `Resolved ${tag}`,
    ...over,
  })) as Seeded;
  seeded.push(round.roundId);
  return round;
};

// A stopped Broadcast leaves the listing, so no other spec sees these Rounds.
test.afterEach(async () => {
  await Promise.all(
    seeded.splice(0).map((roundId) => seed({ command: 'stop', roundId })),
  );
});

const advance = (roundId: string, command: string) =>
  seed({ command, roundId });

const feedRequests = async (request: APIRequestContext) =>
  (await (await request.get(`${feed}/__control/requested`)).json()) as string[];

const videoTime = (page: Page) =>
  page
    .locator('video')
    .evaluate((video: HTMLVideoElement) => video.currentTime);

/** Presses play as a viewer would, and proves frames and time actually advance. */
const expectPlaying = async (page: Page) => {
  const video = page.locator('video');
  await expect(video).toBeVisible();
  // The engine attaches after hydration; a viewer's first press is on a loaded video.
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.currentSrc),
    )
    .not.toBe('');
  await video.evaluate((element: HTMLVideoElement) => {
    element.muted = true;
    return element.play();
  });
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.videoWidth),
    )
    .toBeGreaterThan(0);
  const from = await videoTime(page);
  await expect.poll(() => videoTime(page)).toBeGreaterThan(from + 1);
};

test.describe('watching with no account', () => {
  test('a visitor finds a live Round and plays it, under the strict CSP, with no device and no room', async ({
    page,
    context,
  }) => {
    const round = await liveRound();
    const csp = await watchCspViolations(page);
    await page.addInitScript(() => {
      const calls: string[] = [];
      Reflect.set(window, '__deviceCalls', calls);
      const workers: { url: string; failed: boolean; heard: boolean }[] = [];
      Reflect.set(window, '__workers', workers);
      const RealWorker = window.Worker;
      window.Worker = class extends RealWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          const seen = { url: String(url), failed: false, heard: false };
          workers.push(seen);
          this.addEventListener('error', () => (seen.failed = true));
          this.addEventListener('message', () => (seen.heard = true));
        }
      };
      const devices = navigator.mediaDevices;
      if (devices)
        devices.getUserMedia = () => {
          calls.push('getUserMedia');
          return Promise.reject(new Error('refused'));
        };
    });
    const sockets: string[] = [];
    page.on('websocket', (socket) => sockets.push(socket.url()));
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));

    await page.goto('/');
    await page
      .getByRole('region', { name: 'Live now' })
      .getByRole('link', { name: 'See all live debates' })
      .click();
    await expect(page).toHaveURL('/watch');
    const search = page.getByRole('search', { name: 'Filter live debates' });
    await search
      .getByRole('searchbox', { name: 'Search debaters or rooms' })
      .fill(round.aff);
    await search.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText(`@${round.aff}`).first()).toBeVisible();
    await page.getByRole('link', { name: 'Watch live' }).click();
    await expect(page).toHaveURL(`/watch/${round.roundId}`);

    await expectPlaying(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Resolved',
    );
    expect(await csp.read()).toEqual({
      consoleViolations: [],
      eventViolations: [],
    });
    // hls.js falls back to the main thread in silence, so prove its worker ran.
    expect(
      await page.evaluate(() =>
        (
          Reflect.get(window, '__workers') as {
            url: string;
            failed: boolean;
            heard: boolean;
          }[]
        ).map(({ url, failed, heard }) => [
          new URL(url, 'https://x.invalid').pathname.startsWith('/_next/'),
          failed,
          heard,
        ]),
      ),
    ).toEqual([[true, false, true]]);
    expect(
      requests.some((url) =>
        url.startsWith(`${feed}/live/${round.broadcastId}/master.m3u8`),
      ),
    ).toBe(true);
    expect(
      requests.filter((url) => /livekit|\/api\/[^?]*media/i.test(url)),
    ).toEqual([]);
    expect(sockets.filter((url) => /livekit|rtc/i.test(url))).toEqual([]);
    expect(
      await page.evaluate(() => Reflect.get(window, '__deviceCalls')),
    ).toEqual([]);
    expect(await context.cookies()).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ name: expect.stringMatching(/session/i) }),
      ]),
    );
  });

  test('the player works by keyboard, and repeats the facts for a screen reader', async ({
    page,
  }) => {
    const round = await liveRound();
    await page.goto(`/watch/${round.roundId}`);
    await expect(page.locator('video')).toHaveAccessibleName(
      'Broadcast of this debate',
    );
    await expect(page.locator('video')).toHaveAttribute('controls', '');
    const facts = page.getByRole('region', { name: 'Round facts' });
    await expect(facts.getByText(`Affirmative: ${round.aff}`)).toBeVisible();
    await expect(facts.getByRole('list', { name: 'Captions' })).toContainText(
      round.caption,
    );
    await expect(page.getByTestId('broadcast-caption')).toContainText(
      round.caption,
    );
    const captions = page.getByRole('button', { name: 'Captions' });
    await captions.focus();
    await page.keyboard.press('Space');
    await expect(captions).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('broadcast-caption')).toHaveCount(0);
    await assertNoSeriousFindings(page);
  });

  test('captions are on ranked Rounds only', async ({ page }) => {
    const round = await liveRound({ mode: 'casual' });
    await page.goto(`/watch/${round.roundId}`);
    await expectPlaying(page);
    await expect(page.getByRole('button', { name: 'Captions' })).toHaveCount(0);
    await expect(page.getByText(round.caption)).toHaveCount(0);
  });

  test('a private Round and a stale link answer the same, and read no media', async ({
    page,
    request,
  }) => {
    const hidden = await liveRound({ mode: 'casual', visibility: 'private' });
    const before = (await feedRequests(request)).length;
    await page.goto(`/watch/${hidden.roundId}`);
    await expect(
      page.getByRole('heading', { name: 'This debate is not available' }),
    ).toBeVisible();
    const refused = await page.locator('main').innerText();
    await page.goto('/watch/abcdefghijklmnopqrstuvwx');
    expect(await page.locator('main').innerText()).toBe(refused);
    expect(
      (await request.get(`/api/rounds/${hidden.roundId}/timeline`)).status(),
    ).toBe(404);
    await page.goto(`/watch?q=${hidden.aff}`);
    await expect(page.getByText(`@${hidden.aff}`)).toHaveCount(0);
    expect(
      (await feedRequests(request))
        .slice(before)
        .filter((path) => path.includes(hidden.broadcastId)),
    ).toEqual([]);
  });

  test('an unlisted Round offers no stream by its Round id', async ({
    page,
  }) => {
    const round = await liveRound({ mode: 'casual', visibility: 'unlisted' });
    await page.goto(`/watch/${round.roundId}`);
    await expect(page.locator('video')).toHaveCount(0);
    await expect(
      page.getByText('This debate is not being broadcast'),
    ).toBeVisible();
  });

  test('a slate and an interruption keep the viewing, and say what is happening', async ({
    page,
  }) => {
    const round = await liveRound();
    await page.goto(`/watch/${round.roundId}`);
    await expectPlaying(page);
    await advance(round.roundId, 'slate');
    await expect(
      page.getByText('The stage returns when the next speech starts.'),
    ).toBeVisible();
    await expect(page.locator('video')).toBeVisible();
    await advance(round.roundId, 'interrupt');
    await expect(
      page.getByText(
        'The broadcast is interrupted. It resumes here by itself.',
      ),
    ).toBeVisible();
    await advance(round.roundId, 'on-air');
    await expect(page.getByText('The broadcast is interrupted')).toHaveCount(0);
  });

  test('a weak connection adapts down and keeps playing', async ({
    page,
    context,
  }) => {
    const round = await liveRound();
    const network = await context.newCDPSession(page);
    await network.send('Network.enable');
    await page.goto(`/watch/${round.roundId}`);
    await expectPlaying(page);
    await network.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 50,
      // Between the fixture's two renditions: only the lower one fits.
      downloadThroughput: Math.round(180_000 / 8),
      uploadThroughput: Math.round(180_000 / 8),
    });
    await expect
      .poll(
        () =>
          page
            .locator('video')
            .evaluate((video: HTMLVideoElement) => video.videoHeight),
        { timeout: 20_000 },
      )
      .toBe(240);
    const from = await videoTime(page);
    await expect.poll(() => videoTime(page)).toBeGreaterThan(from + 1);
  });

  test('a stop ends playback for a connected viewer within the recorded bound', async ({
    page,
  }) => {
    const round = await liveRound();
    await page.goto(`/watch/${round.roundId}`);
    await expectPlaying(page);
    const stoppedAt = performance.now();
    await advance(round.roundId, 'stop');
    await expect(page.getByText('This broadcast was stopped')).toBeVisible();
    await expect(page.locator('video')).toHaveCount(0);
    // DEC-303: within 60 seconds.
    expect(performance.now() - stoppedAt).toBeLessThan(60_000);
  });

  test('the end plays out, then the viewer returns to the Recording', async ({
    page,
    request,
  }) => {
    const round = await liveRound();
    await page.goto(`/watch/${round.roundId}`);
    await expectPlaying(page);
    await advance(round.roundId, 'end');
    await request.get(`${feed}/__control/finish/${round.broadcastId}`);
    // Still the viewer's final seconds until the video says it reached the end.
    await expect(page.getByText('This debate has ended')).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page
        .getByText('The Affirmative won', { exact: false })
        .or(page.getByText('Affirmative won')),
    ).toBeVisible();
    await expect(
      page.getByText('The recording is being prepared'),
    ).toBeVisible();
    await advance(round.roundId, 'recording-ready');
    await expect(page).toHaveURL(`/recordings/${round.roundId}`, {
      timeout: 15_000,
    });
  });

  test('Stream this Round offers the played feed, and goes with it', async ({
    page,
  }, testInfo) => {
    const round = await liveRound();
    await page.goto(`/watch/${round.roundId}`);
    await expectPlaying(page);
    const panel = page.getByRole('region', { name: 'Stream this Round' });
    const feed = panel.getByRole('textbox', { name: 'Official feed URL' });
    const played = await page
      .locator('video')
      .evaluate(() => performance.getEntriesByType('resource'))
      .then((entries) =>
        entries
          .map((entry) => entry.name)
          .find((name) => name.endsWith('/master.m3u8')),
      );
    await expect(feed).toHaveValue(played ?? 'no master playlist was read');
    await expect(panel).toContainText('no stream key');
    await expect(
      panel.getByRole('link', { name: 'ranked content policy' }),
    ).toHaveAttribute('href', '/content-policy');
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('stream-this-round.png'),
      fullPage: true,
    });
    await advance(round.roundId, 'stop');
    await expect(page.getByText('This broadcast was stopped')).toBeVisible();
    await expect(panel).toHaveCount(0);
  });

  test('Stream this Round is usable with no script, and absent where there is no feed', async ({
    browser,
    page,
  }) => {
    const casual = await liveRound({ mode: 'casual', visibility: 'unlisted' });
    await page.goto(`/watch/${casual.roundId}`);
    await expect(
      page.getByText('This debate is not being broadcast'),
    ).toBeVisible();
    await expect(page.getByText('Stream this Round')).toHaveCount(0);
    const round = await liveRound();
    const context = await browser.newContext({
      javaScriptEnabled: false,
      ignoreHTTPSErrors: true,
    });
    try {
      const bare = await openPage(context, 'Streamer with no script');
      await bare.goto(`/watch/${round.roundId}`);
      const panel = bare.getByRole('region', { name: 'Stream this Round' });
      await expect(
        panel.getByRole('textbox', { name: 'Official feed URL' }),
      ).toHaveValue(/\/live\/.+\/master\.m3u8$/);
      await expect(panel.getByRole('button', { name: 'Copy' })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('with no script the facts still render', async ({ browser }) => {
    const round = await liveRound();
    const context = await browser.newContext({
      javaScriptEnabled: false,
      ignoreHTTPSErrors: true,
    });
    try {
      const page = await openPage(context, 'Viewer with no script');
      await page.goto(`/watch/${round.roundId}`);
      await expect(
        page.getByRole('region', { name: 'Round facts' }),
      ).toContainText(round.aff);
      // A locator never reads into noscript, so read the markup the browser parsed.
      expect(await page.content()).toContain('The video needs JavaScript');
    } finally {
      await context.close();
    }
  });

  test('a debater’s profile leads to their live Round', async ({ page }) => {
    const round = await liveRound();
    await page.goto(`/profile/${round.aff}`);
    await page.getByRole('link', { name: /Watch live/ }).click();
    await expect(page).toHaveURL(`/watch/${round.roundId}`);
  });
});
