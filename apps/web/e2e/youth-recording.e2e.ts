import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { systemClock } from '@daisy/clock';
import { createId } from '@paralleldrive/cuid2';
import { assertNoSeriousFindings } from './support/axe';
import { origin, signUpMember, youthBirth } from './support/accounts';
import { expect, openPage, test } from './support/fixtures';

/**
 * PYL-5 in a real browser: a Youth Round's Recording reads as private to the
 * debater who sat in it, with Share publicly closed and Take down in place of
 * Remove, and no Youth Round is listed on Watch, in the archive, or open to a
 * stranger by its address.
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
    seeded.splice(0).map((roundId) => seed({ command: 'stop', roundId })),
  );
});

const ranked = async (input: Record<string, unknown>) => {
  const round = (await seed({
    command: 'create',
    mode: 'ranked',
    visibility: 'public',
    ...input,
  })) as { roundId: string };
  seeded.push(round.roundId);
  return round.roundId;
};

test('a Youth debater sees their Recording as private, with Take down and no public share', async ({
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
  await expect(page.getByText('Youth – Freestyle').first()).toBeVisible();
  const sharing = page.getByRole('region', { name: 'Sharing' });
  await expect(sharing).toContainText(
    'Private: visible to the debaters, judges and their coaches or parents.',
  );
  await expect(sharing).toContainText(
    'Share publicly needs a media release from every youth debater',
  );
  await expect(
    sharing.getByRole('button', { name: 'Share publicly' }),
  ).toBeDisabled();
  await expect(sharing.getByText('Copy link')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download video' })).toHaveCount(
    0,
  );
  await expect(page.getByText('Take down this recording')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Take down', exact: true }),
  ).toBeVisible();
  await assertNoSeriousFindings(page);

  // The debater's own profile lists it; a stranger's view of it does not.
  await page.goto(`/profile/${username}`);
  await expect(page.getByText(`Resolved ${tag}`)).toBeVisible();
  const stranger = await page.context().browser()!.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  try {
    const visitor = await openPage(stranger, 'visitor');
    await visitor.goto(`/profile/${username}`);
    await expect(visitor.getByText(`@${username}`).first()).toBeVisible();
    await expect(visitor.getByText(`Resolved ${tag}`)).toHaveCount(0);
  } finally {
    await stranger.close();
  }
});

test('Watch, the archive and a stranger never find a Youth Round', async ({
  browser,
}) => {
  const tag = createId().slice(0, 8);
  await ranked({
    title: `Open final ${tag}`,
    resolution: `Resolved ${tag}`,
  });
  const youthLive = await ranked({
    division: 'youth',
    title: `Youth live ${tag}`,
    resolution: `Resolved ${tag}`,
  });
  const youthEnded = await ranked({
    division: 'youth',
    title: `Youth ended ${tag}`,
    resolution: `Resolved ${tag}`,
  });
  await seed({ command: 'end', roundId: youthEnded });
  await seed({ command: 'recording-ready', roundId: youthEnded });

  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  try {
    const visitor = await openPage(context, 'visitor');
    await visitor.goto(`/watch?q=${tag}`);
    await expect(visitor.getByText(`Open final ${tag}`)).toBeVisible();
    await expect(
      visitor
        .getByText('Open – Freestyle', { exact: true })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await expect(visitor.getByText(`Youth live ${tag}`)).toHaveCount(0);
    await expect(
      visitor.getByRole('combobox', { name: 'Ladder' }),
    ).toBeVisible();

    await visitor.goto(`/watch/${youthLive}`);
    await expect(visitor.getByText(`Youth live ${tag}`)).toHaveCount(0);

    await visitor.goto(`/recordings?q=${tag}`);
    await expect(visitor.getByText(`Youth ended ${tag}`)).toHaveCount(0);

    await visitor.goto(`/recordings/${youthEnded}`);
    await expect(visitor.getByText(`Youth ended ${tag}`)).toHaveCount(0);
    await expect(visitor.locator('video')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
