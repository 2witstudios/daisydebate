import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { systemClock } from '@daisy/clock';
import { createId } from '@paralleldrive/cuid2';
import { assertNoSeriousFindings } from './support/axe';
import { origin, signUpMember, youthBirth } from './support/accounts';
import { expect, openPage, test } from './support/fixtures';

/**
 * ADR 0161 in a real browser: a Youth Round is viewed exactly as an Open one.
 * A stranger finds a live ranked Youth Round on Watch, watches it, and finds
 * it ended in the archive and on its debater's profile; a public casual Youth
 * Room's Round is watchable as an Open one is (Stream this Round's reuse
 * fence is proven on a playing feed in watch-broadcast.e2e.ts). Its Recording reads as an Open one's (no Private badge, no Share publicly)
 * and its youth debater may still take it down.
 */
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
    seeded.splice(0).map((roundId) => seed({ command: 'retire', roundId })),
  );
});

const seedRound = async (
  mode: 'ranked' | 'casual',
  input: Record<string, unknown>,
) => {
  const round = (await seed({
    command: 'create',
    mode,
    visibility: 'public',
    ...input,
  })) as { roundId: string };
  seeded.push(round.roundId);
  return round.roundId;
};
const ranked = (input: Record<string, unknown>) => seedRound('ranked', input);
const casual = (input: Record<string, unknown>) => seedRound('casual', input);

test('a stranger watches a live ranked Youth Round, then finds it in the archive and on the profile', async ({
  browser,
  context,
}) => {
  const { username } = await signUpMember(
    context.request,
    youthBirth(systemClock.now()),
  );
  const tag = createId().slice(0, 8);
  const youthLive = await ranked({
    division: 'youth',
    affUsername: username,
    title: `Youth final ${tag}`,
    resolution: `Youth motion ${tag}`,
  });
  const stranger = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  try {
    const visitor = await openPage(stranger, 'visitor');
    await visitor.goto(`/watch?q=${tag}`);
    await visitor
      .getByRole('navigation', { name: 'Lobby', exact: true })
      .getByRole('link', { name: 'Youth', exact: true })
      .click();
    await expect(visitor.getByText(`Youth final ${tag}`)).toBeVisible();
    // No page names a ladder inside a lobby (ADR 0156 copy rule).
    await expect(visitor.getByRole('main')).not.toContainText(
      'Youth – Freestyle',
    );
    await visitor.goto(`/watch/${youthLive}`);
    await expect(
      visitor.getByText(`Youth motion ${tag}`).first(),
    ).toBeVisible();
    await expect(visitor.getByText('This debate is not available')).toHaveCount(
      0,
    );

    await seed({ command: 'end', roundId: youthLive });
    await seed({ command: 'recording-ready', roundId: youthLive });
    await visitor.goto(`/recordings?q=${tag}`);
    await expect(visitor.getByText(`Youth final ${tag}`)).toBeVisible();
    await visitor.goto(`/recordings/${youthLive}`);
    await expect(
      visitor.getByRole('heading', { name: `Youth final ${tag}` }),
    ).toBeVisible();
    await expect(visitor.locator('video')).toHaveCount(1);
    await visitor.goto(`/profile/${username}`);
    await expect(visitor.getByText(`Youth motion ${tag}`)).toBeVisible();
    await assertNoSeriousFindings(visitor);
  } finally {
    await stranger.close();
  }
});

test('a public casual Youth Round is listed and watched as an Open one is', async ({
  browser,
}) => {
  const tag = createId().slice(0, 8);
  const openLive = await casual({
    title: `Open casual ${tag}`,
    resolution: `Open casual motion ${tag}`,
  });
  const youthLive = await casual({
    division: 'youth',
    title: `Youth casual ${tag}`,
    resolution: `Youth casual motion ${tag}`,
  });
  const stranger = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  try {
    const visitor = await openPage(stranger, 'visitor');
    await visitor.goto(`/watch?q=${tag}`);
    await expect(visitor.getByText(`Open casual ${tag}`)).toBeVisible();
    await expect(visitor.getByText(`Youth casual ${tag}`)).toHaveCount(0);
    await visitor
      .getByRole('navigation', { name: 'Lobby', exact: true })
      .getByRole('link', { name: 'Youth', exact: true })
      .click();
    await expect(visitor.getByText(`Youth casual ${tag}`)).toBeVisible();
    await expect(visitor.getByText(`Open casual ${tag}`)).toHaveCount(0);
    for (const [roundId, motion] of [
      [openLive, `Open casual motion ${tag}`],
      [youthLive, `Youth casual motion ${tag}`],
    ] as const) {
      await visitor.goto(`/watch/${roundId}`);
      await expect(visitor.getByText(motion).first()).toBeVisible();
    }
  } finally {
    await stranger.close();
  }
});

test('a Youth debater’s Recording reads as an Open one, with Take down and no download', async ({
  page,
  context,
}) => {
  const { username } = await signUpMember(
    context.request,
    youthBirth(systemClock.now()),
  );
  const tag = createId().slice(0, 8);
  const roundId = await ranked({
    division: 'youth',
    affUsername: username,
    title: `Youth scrimmage ${tag}`,
    resolution: `Resolved ${tag}`,
  });
  await seed({ command: 'end', roundId });
  await seed({ command: 'recording-ready', roundId });

  await page.goto(`/recordings/${roundId}`);
  await expect(
    page.getByRole('heading', { name: `Youth scrimmage ${tag}` }),
  ).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText('Youth – Freestyle');
  const sharing = page.getByRole('region', { name: 'Sharing' });
  await expect(sharing).toContainText('Anyone can replay it.');
  await expect(sharing.getByText('Copy link')).toBeVisible();
  await expect(sharing).not.toContainText('Private');
  await expect(page.getByText('Share publicly')).toHaveCount(0);
  // Without every youth debater's release, nothing is downloaded (the reuse fence).
  await expect(page.getByRole('link', { name: 'Download video' })).toHaveCount(
    0,
  );
  await expect(page.getByText('Take down this recording')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Take down', exact: true }),
  ).toBeVisible();
  await assertNoSeriousFindings(page);
});

test('age-evidence erasure keeps mixed-age Recording downloads fenced', async ({
  page,
  context,
  browser,
}) => {
  const { username: adult } = await signUpMember(context.request);
  await seed({ command: 'grant-download', username: adult });
  const minorContext = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  const { lobbyId } = (await seed({
    command: 'open-lobby',
    name: `Any age ${createId().slice(0, 8)}`,
    ageRule: 'anyone',
  })) as { lobbyId: string };
  try {
    const { username: minor } = await signUpMember(
      minorContext.request,
      youthBirth(systemClock.now()),
    );
    const mixed = await casual({
      lobbyId,
      visibility: 'private',
      hostUsername: adult,
      affUsername: minor,
      negUsername: adult,
      title: 'Mixed-age scrimmage',
      resolution: 'The mixed-age resolution',
    });
    const ordinary = await casual({
      visibility: 'private',
      negUsername: adult,
      title: 'Adult scrimmage',
      resolution: 'The adult resolution',
    });
    const ready = async (roundId: string) => {
      await seed({ command: 'end', roundId });
      const recordingId = await seed({ command: 'recording-ready', roundId });
      return `/api/recordings/${recordingId}/download`;
    };
    const mixedDownload = await ready(mixed);
    const ordinaryDownload = await ready(ordinary);
    await seed({ command: 'erase-age-evidence', username: minor });

    await page.goto(`/recordings/${mixed}`);
    await expect(
      page.getByRole('heading', { name: 'Mixed-age scrimmage' }),
    ).toBeVisible();
    await expect(page.locator('video')).toHaveCount(1);
    const download = page.getByRole('link', { name: 'Download video' });
    await expect(download).toHaveCount(0);
    const fenced = await context.request.get(mixedDownload, {
      maxRedirects: 0,
    });
    expect(fenced.status()).toBe(404);
    expect(fenced.headers().location).toBeUndefined();

    await page.goto(`/recordings/${ordinary}`);
    await expect(download).toHaveAttribute('href', ordinaryDownload);
    const allowed = await context.request.get(ordinaryDownload, {
      maxRedirects: 0,
    });
    expect(allowed.status()).toBe(302);
    expect(allowed.headers().location).toContain('/video.mp4');
  } finally {
    await minorContext.close();
    await seed({ command: 'close-lobby', lobbyId });
  }
});
