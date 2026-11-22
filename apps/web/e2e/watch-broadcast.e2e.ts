import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { createId } from '@paralleldrive/cuid2';
import type { APIRequestContext, Page, Route } from '@playwright/test';
import { signUpMember } from './support/accounts';
import { assertNoSeriousFindings } from './support/axe';
import { watchCspViolations } from './support/csp';
import { expect, openPage, test } from './support/fixtures';
import { closeRoom, submitCreateRoom } from './support/room-launch-flow';
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
    title: string;
    division: 'open' | 'youth';
    lobbyId: string;
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

test('Watch lists public broadcasts in the selected lobby only', async ({
  page,
}) => {
  const token = createId().slice(0, 8);
  const openTitle = `Open debate ${token}`;
  const youthTitle = `Youth debate ${token}`;
  await liveRound({ title: openTitle, mode: 'casual' });
  await liveRound({ title: youthTitle, mode: 'casual', division: 'youth' });
  const switcher = page.getByRole('navigation', { name: 'Lobby', exact: true });
  await page.goto(`/watch?q=${token}`);
  await expect(page.getByText(openTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(youthTitle, { exact: true })).toHaveCount(0);
  await switcher.getByRole('link', { name: 'Youth', exact: true }).click();
  await expect(page.getByText(youthTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(openTitle, { exact: true })).toHaveCount(0);
});

test('two official adult lobbies keep Watch and new Rooms on the selected lobby ID', async ({
  browser,
  page,
}) => {
  const token = createId().slice(0, 8);
  const name = `Valley ${token}`;
  const { lobbyId } = (await seed({ command: 'open-lobby', name })) as {
    lobbyId: string;
  };
  try {
    const own = `Open debate ${token}`;
    const other = `Valley debate ${token}`;
    await liveRound({ title: own, mode: 'casual' });
    const foreign = await liveRound({ title: other, mode: 'casual', lobbyId });
    const switcher = page.getByRole('navigation', {
      name: 'Lobby',
      exact: true,
    });
    await page.goto(`/watch?q=${token}`);
    await expect(page.getByText(own, { exact: true })).toBeVisible();
    await expect(page.getByText(other, { exact: true })).toHaveCount(0);
    const openHref = await switcher
      .getByRole('link', { name: 'Open', exact: true })
      .getAttribute('href');
    if (!openHref) throw new Error('Open lobby link was missing');
    await switcher.getByRole('link', { name, exact: true }).click();
    await expect(page.getByText(other, { exact: true })).toBeVisible();
    await expect(page.getByText(own, { exact: true })).toHaveCount(0);
    await expect(
      page
        .getByRole('navigation', { name: 'Watch sections' })
        .getByRole('link', { name: /^Live/ }),
    ).toHaveText(/Live\s*1$/);
    await page.goto(`${openHref}&before=${foreign.roundId}`);
    await expect(page.getByText(own, { exact: true })).toHaveCount(0);

    const native = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      ignoreHTTPSErrors: true,
      javaScriptEnabled: false,
    });
    try {
      const host = await openPage(native, 'host in second official lobby');
      await signUpMember(host.request);
      await host.goto(`/lobby?lobby=${lobbyId}`);
      await host
        .getByRole('link', { name: 'New room', exact: true })
        .first()
        .click();
      const title = `Selected Room ${token}`;
      const room = await submitCreateRoom(host, title, 'freestyle', false);
      try {
        await host.goto(`/lobby?lobby=${lobbyId}&q=${token}`);
        await expect(
          host
            .getByRole('region', { name: 'Available rooms' })
            .getByText(title, { exact: true }),
        ).toBeVisible();
      } finally {
        await closeRoom(host.request, room.id);
      }
    } finally {
      await native.close();
    }
  } finally {
    await seed({ command: 'close-lobby', lobbyId });
  }
});

// Retired fixtures leave both the Watch listing and the stand-in's polling set.
test.afterEach(async () => {
  await Promise.all(
    seeded.splice(0).map((roundId) => seed({ command: 'retire', roundId })),
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
      page.getByText('The video is showing a slate. Nobody is speaking.'),
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

  test('a Youth broadcast plays while Stream this Round follows both debaters’ releases', async ({
    page,
  }) => {
    const round = await liveRound({ division: 'youth' });
    const watch = `/watch/${round.roundId}`;
    const panel = page.getByRole('region', { name: 'Stream this Round' });
    await page.goto(watch);
    await expectPlaying(page);
    await expect(panel).toHaveCount(0);

    await advance(round.roundId, 'release-reuse');
    // The server holds Watch reads for one second. Reload until the new
    // release state is served without coupling this test to that duration.
    const feedUrl = panel.getByRole('textbox', { name: 'Official feed URL' });
    await expect(async () => {
      await page.reload();
      await expect(feedUrl).toHaveValue(/\/live\/.+\/master\.m3u8$/, {
        timeout: 500,
      });
    }).toPass({ timeout: 5_000 });
    await expectPlaying(page);

    await advance(round.roundId, 'withdraw-reuse');
    await expect(async () => {
      await page.reload();
      await expect(panel).toHaveCount(0, { timeout: 500 });
    }).toPass({ timeout: 5_000 });
    await expectPlaying(page);
  });

  test('Stream this Round is usable with no script, and absent where there is no feed', async ({
    browser,
    page,
  }) => {
    const casual = await liveRound({ mode: 'casual', visibility: 'unlisted' });
    await page.goto(`/watch/${casual.roundId}`);
    await expect(
      page.getByRole('heading', { name: REFUSED, exact: true }),
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
    const watching = await openPage(visitor, 'the link holder');
    const bare = await openPage(
      await browser.newContext(),
      'a visitor with no link',
    );
    await bare.goto(`/watch/${round.roundId}`);
    await expect(
      bare.getByRole('heading', { name: REFUSED, exact: true }),
    ).toBeVisible();

    // The token is in one request's URL, then in an HttpOnly cookie alone.
    const opened = await watching.request.get(first, { maxRedirects: 0 });
    expect(opened.status()).toBe(303);
    expect(opened.headers()['referrer-policy']).toBe('no-referrer');
    expect(opened.headers()['cache-control']).toContain('no-store');
    await watching.goto(first);
    expect(new URL(watching.url()).pathname).toBe(`/watch/${round.roundId}`);
    expect(new URL(watching.url()).search).toBe('');
    await expect(
      watching.getByRole('heading', {
        name: REFUSED,
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(0);
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
    await expect(
      watching.getByRole('heading', { name: REFUSED, exact: true }),
    ).toBeVisible();
    await watching.goto(first);
    await expect(
      watching.getByRole('heading', { name: REFUSED, exact: true }),
    ).toBeVisible();
    await watching.goto(second);
    await expect(
      watching.getByRole('heading', {
        name: REFUSED,
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(0);

    // A wrong link and a missing Round are one answer.
    const wrong = await browser.newContext();
    const wrongPage = await openPage(wrong, 'a wrong link');
    await wrongPage.goto(
      `/watch/${round.roundId}/link?token=${'A'.repeat(43)}`,
    );
    const missingPage = await openPage(wrong, 'a missing Round');
    await missingPage.goto(`/watch/${createId()}`);
    expect(await wrongPage.locator('main').innerText()).toBe(
      await missingPage.locator('main').innerText(),
    );
    await wrong.close();
    await bare.context().close();
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
    const stranger = await openPage(
      await browser.newContext(),
      'a visitor with no link',
    );
    await stranger.goto(recording);
    await expect(
      stranger.getByRole('heading', { name: REFUSED, exact: true }),
    ).toBeVisible();
    const holder = await browser.newContext();
    const holding = await openPage(holder, 'the link holder');
    await holding.goto(link);
    await holding.goto(recording);
    await expect(
      holding.getByRole('heading', {
        name: REFUSED,
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(0);
    await expect(
      holding.getByRole('region', { name: 'Sharing' }),
    ).toContainText('unlisted');
    await expect(
      holding.getByRole('region', { name: 'Sharing' }).getByRole('button'),
    ).toHaveCount(0);
    await stranger.context().close();
    await holder.close();
  });
});

test.describe('an unlisted Round by its link', () => {
  const stateObject = (url: URL) =>
    url.origin === feed && url.pathname.startsWith('/state/');
  const missingState = (route: Route) =>
    route.fulfill({
      status: 404,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });

  test('replacement removes the player before its first published state read', async ({
    page,
    context,
    browser,
    request,
  }) => {
    const { username } = await signUpMember(context.request);
    const round = await liveRound({
      mode: 'casual',
      visibility: 'unlisted',
      hostUsername: username,
    });
    const hostPage = `/rounds/${round.roundId}/audience-link`;
    const watchPage = `/watch/${round.roundId}`;
    await page.goto(hostPage);
    const link = await issueLink(page, 'Create link');
    await page.goto(hostPage);

    const visitor = await browser.newContext({ ignoreHTTPSErrors: true });
    const release = Promise.withResolvers<void>();
    try {
      const watching = await openPage(visitor, 'the link holder before state');
      await watching.route(stateObject, async (route) => {
        await release.promise;
        await missingState(route);
      });
      const started = watching.waitForRequest((read) =>
        stateObject(new URL(read.url())),
      );
      await watching.goto(link);
      await expectPlaying(watching);
      const streamPanel = watching.getByRole('region', {
        name: 'Stream this Round',
      });
      await expect(streamPanel).toBeVisible();
      const oldState = (await started).url();
      // Observe real withdrawal before delivering the 404 to the browser.
      // A late stand-in publication must never let this tab consume old state.
      await expect
        .poll(async () => (await request.get(oldState)).status())
        .toBe(200);
      await issueLink(page, 'Replace link');
      await expect
        .poll(async () => (await request.get(oldState)).status())
        .toBe(404);
      release.resolve();

      await expect(
        watching.getByRole('heading', { name: REFUSED, exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(watching).toHaveURL(watchPage);
      await expect(watching.locator('video')).toHaveCount(0);
      await expect(streamPanel).toHaveCount(0);
    } finally {
      release.resolve();
      await visitor.close();
    }
  });

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
    const watching = await openPage(visitor, 'the link holder');
    // The first state is not out yet. The real Watch page rechecks admission
    // and keeps showing the player, then the next reads reach the real bucket.
    await watching.route(stateObject, missingState, { times: 1 });
    let carriedToken = false;
    const reads: string[] = [];
    watching.on('request', (sent) => {
      reads.push(sent.url());
      const { referer } = sent.headers();
      if (sent.isNavigationRequest() && sent.url().includes(token)) return;
      if (sent.url().includes(token) || referer?.includes(token))
        carriedToken = true;
    });
    const startup = Promise.all([
      watching.waitForResponse(
        (read) => stateObject(new URL(read.url())) && read.ok(),
      ),
      watching.waitForResponse(
        (read) =>
          new URL(read.url()).pathname === `/watch/${round.roundId}` &&
          read.request().headers()['rsc'] === '1' &&
          read.ok(),
      ),
    ]);
    await watching.goto(link);
    await expectPlaying(watching);
    await startup;
    await expect(watching.locator('video')).toBeVisible();
    // A later change in the published object proves the tab consumed state
    // before testing replacement in the already-published case.
    await advance(round.roundId, 'interrupt');
    await expect(
      watching.getByText(
        'The broadcast is interrupted. It resumes here by itself.',
      ),
    ).toBeVisible();
    expect(
      reads.some((url) => url.startsWith(`${feed}/live/${round.feedKey}/`)),
    ).toBe(true);
    expect(reads.some((url) => url.includes(round.broadcastId))).toBe(false);

    const streamPanel = watching.getByRole('region', {
      name: 'Stream this Round',
    });
    await expect(watching.locator('video')).toBeVisible();
    await expect(streamPanel).toBeVisible();
    await page.goto(`/rounds/${round.roundId}/audience-link`);
    await issueLink(page, 'Replace link');
    await expect(
      watching.getByRole('heading', { name: REFUSED, exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(watching.locator('video')).toHaveCount(0);
    await expect(streamPanel).toHaveCount(0);
    expect(carriedToken).toBe(false);
    await visitor.close();
  });
});
