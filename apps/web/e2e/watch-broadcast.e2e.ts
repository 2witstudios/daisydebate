import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { createId } from '@paralleldrive/cuid2';
import type { APIRequestContext, Page } from '@playwright/test';
import { signUpMember } from './support/accounts';
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
  readonly feedKey: string;
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
    hostUsername: string;
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
        url.startsWith(`${feed}/live/${round.feedKey}/master.m3u8`),
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
        .filter((path) => path.includes(hidden.feedKey)),
    ).toEqual([]);
  });

  test('an unlisted Round cannot be reached by its Round id', async ({
    page,
  }) => {
    const round = await liveRound({ mode: 'casual', visibility: 'unlisted' });
    await page.goto(`/watch/${round.roundId}`);
    await expect(page.locator('video')).toHaveCount(0);
    await expect(page.getByText('This debate is not available')).toBeVisible();
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
    await request.get(`${feed}/__control/finish/${round.feedKey}`);
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

const REFUSED = 'This debate is not available';

/** The host asks for a link on their own page, and reads the one answer it is in. */
const issueLink = async (
  page: Page,
  button: 'Create link' | 'Replace link',
) => {
  await page.getByRole('button', { name: button }).click();
  const link = await page.getByLabel('Round link').inputValue();
  expect(page.url()).not.toContain('token');
  return link;
};

test.describe('an unlisted Round by its link, with JavaScript off', () => {
  test.use({ javaScriptEnabled: false });

  test('the host issues and replaces it, and only the current link opens the Round', async ({
    page,
    context,
    browser,
  }) => {
    const { username } = await signUpMember(context.request);
    const round = await liveRound({
      mode: 'casual',
      visibility: 'unlisted',
      hostUsername: username,
    });
    const hostPage = `/rounds/${round.roundId}/audience-link`;
    await page.goto(hostPage);
    const first = await issueLink(page, 'Create link');
    expect(first).toContain(`/watch/${round.roundId}/link?token=`);

    // Shown once: coming back, the link is nowhere, and it can only be replaced.
    await page.goto(hostPage);
    await expect(page.getByLabel('Round link')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('token=');
    await expect(
      page.getByRole('button', { name: 'Replace link' }),
    ).toBeVisible();

    const visitor = await browser.newContext();
    const watching = await visitor.newPage();
    const bare = await browser.newPage();
    await bare.goto(`/watch/${round.roundId}`);
    await expect(bare.getByText(REFUSED)).toBeVisible();

    // The token is in one request's URL, then in an HttpOnly cookie alone.
    const opened = await watching.request.get(first, { maxRedirects: 0 });
    expect(opened.status()).toBe(303);
    expect(opened.headers()['referrer-policy']).toBe('no-referrer');
    expect(opened.headers()['cache-control']).toContain('no-store');
    await watching.goto(first);
    expect(new URL(watching.url()).pathname).toBe(`/watch/${round.roundId}`);
    expect(new URL(watching.url()).search).toBe('');
    await expect(watching.getByText(REFUSED)).toHaveCount(0);
    await expect(watching.getByText(round.aff).first()).toBeVisible();
    const [cookie] = (await visitor.cookies()).filter((c) =>
      c.name.startsWith('daisy_audience_link_'),
    );
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');

    // Replacing kills the old link for the next read, in the same browser.
    await page.goto(hostPage);
    const second = await issueLink(page, 'Replace link');
    expect(second).not.toBe(first);
    await watching.reload();
    await expect(watching.getByText(REFUSED)).toBeVisible();
    await watching.goto(first);
    await expect(watching.getByText(REFUSED)).toBeVisible();
    await watching.goto(second);
    await expect(watching.getByText(REFUSED)).toHaveCount(0);

    // A wrong link and a missing Round are one answer.
    const wrong = await browser.newContext();
    const wrongPage = await wrong.newPage();
    await wrongPage.goto(
      `/watch/${round.roundId}/link?token=${'A'.repeat(43)}`,
    );
    const missingPage = await wrong.newPage();
    await missingPage.goto(`/watch/${createId()}`);
    expect(await wrongPage.locator('main').innerText()).toBe(
      await missingPage.locator('main').innerText(),
    );
    await wrong.close();
    await bare.close();
    await visitor.close();
  });

  test('its Recording opens by the same link, and a stranger finds nothing', async ({
    page,
    context,
    browser,
  }) => {
    const { username } = await signUpMember(context.request);
    const round = await liveRound({
      mode: 'casual',
      visibility: 'unlisted',
      hostUsername: username,
    });
    await page.goto(`/rounds/${round.roundId}/audience-link`);
    const link = await issueLink(page, 'Create link');
    await advance(round.roundId, 'end');
    await advance(round.roundId, 'recording-ready');
    const recording = `/recordings/${round.roundId}`;
    const stranger = await browser.newPage();
    await stranger.goto(recording);
    await expect(stranger.getByText(REFUSED)).toBeVisible();
    const holder = await browser.newContext();
    const holding = await holder.newPage();
    await holding.goto(link);
    await holding.goto(recording);
    await expect(holding.getByText(REFUSED)).toHaveCount(0);
    await expect(
      holding.getByRole('region', { name: 'Sharing' }),
    ).toContainText('unlisted');
    await expect(
      holding.getByRole('region', { name: 'Sharing' }).getByRole('button'),
    ).toHaveCount(0);
    await stranger.close();
    await holder.close();
  });
});

test.describe('an unlisted Round by its link', () => {
  test('a player reads it under its random key, sends the token nowhere, and stops when the link is replaced', async ({
    page,
    context,
    browser,
  }) => {
    const { username } = await signUpMember(context.request);
    const round = await liveRound({
      mode: 'casual',
      visibility: 'unlisted',
      hostUsername: username,
    });
    await page.goto(`/rounds/${round.roundId}/audience-link`);
    const link = await issueLink(page, 'Create link');
    const token = new URL(link).searchParams.get('token')!;

    const visitor = await browser.newContext({ ignoreHTTPSErrors: true });
    const watching = await visitor.newPage();
    const carrying: string[] = [];
    const reads: string[] = [];
    watching.on('request', (sent) => {
      reads.push(sent.url());
      const { referer } = sent.headers();
      if (sent.isNavigationRequest() && sent.url().includes(token)) return;
      if (sent.url().includes(token) || referer?.includes(token))
        carrying.push(sent.url());
    });
    await watching.goto(link);
    await expectPlaying(watching);
    expect(carrying).toEqual([]);
    expect(
      reads.some((url) => url.startsWith(`${feed}/live/${round.feedKey}/`)),
    ).toBe(true);
    expect(reads.some((url) => url.includes(round.broadcastId))).toBe(false);

    await page.getByRole('button', { name: 'Replace link' }).click();
    await expect(page.getByLabel('Round link')).toBeVisible();
    await expect(watching.getByText(REFUSED)).toBeVisible({ timeout: 15_000 });
    await visitor.close();
  });
});
