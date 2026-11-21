import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createId } from '@paralleldrive/cuid2';
import { expect, test } from './support/fixtures';
import { signUpMember } from './support/accounts';

const run = (script: string, ...args: string[]) =>
  promisify(execFile)(
    'bun',
    [fileURLToPath(new URL(`./support/${script}`, import.meta.url)), ...args],
    { timeout: 20000, maxBuffer: 4096 },
  );

test('a league manager opens and closes seasons from the host and publishes an official lobby', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const { username } = await signUpMember(context.request);
  const handle = `league-${createId()}`;
  const hostLeague = `/host/leagues/${handle}`;
  const lobbyName = 'Junior debate';
  const flags = ['daisy-tab', 'host-tiers'];
  try {
    for (const flag of flags)
      await run('release-flag-process.ts', flag, 'enabled');
    await run('standing-lobby-host-process.ts', 'create', handle, username);
    await page.goto('/host');
    await page
      .getByRole('link', { name: 'Open league: Southeast League' })
      .click();
    await expect(page).toHaveURL(new RegExp(`${hostLeague}$`));
    await page.getByRole('link', { name: 'New lobby' }).click();
    await page.getByLabel('Name', { exact: true }).fill(lobbyName);
    await page.getByLabel('Who can debate').selectOption('under-18');
    await page.getByRole('button', { name: 'Create lobby' }).click();
    await expect(page.getByRole('heading', { name: lobbyName })).toBeVisible();
    await expect(page.getByText('No ladders yet')).toBeVisible();
    const management = page.url();

    await page.goto('/');
    await page.getByRole('link', { name: /^Play\b/ }).click();
    await expect(page).toHaveURL(/\/lobby/);
    await expect(page.getByRole('link', { name: lobbyName })).toBeVisible();
    await page.goto('/watch');
    await expect(page.getByRole('link', { name: lobbyName })).toBeVisible();
    await page.goto('/leaderboard');
    await page.getByRole('link', { name: lobbyName }).click();
    await expect(page.getByRole('link', { name: lobbyName })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(management);
    await page.getByRole('link', { name: 'Edit lobby' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Junior debates');
    await page.getByLabel('Who can debate').selectOption('anyone');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(
      page.getByRole('heading', { name: 'Junior debates' }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);

    await page.getByRole('link', { name: 'New ladder' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Junior ladder');
    await page.getByRole('button', { name: 'Create ladder' }).click();
    await expect(
      page.getByText('Junior ladder', { exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Edit ladder' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Junior standings');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(
      page.getByText('Junior standings', { exact: true }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Open season' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Season 1');
    await page.getByRole('button', { name: 'Open season' }).click();
    await expect(page.getByText(/^Active · Started/)).toBeVisible();
    await page.getByRole('link', { name: 'Edit season' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Inaugural season');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(
      page.getByText('Inaugural season', { exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Close season' }).click();
    await expect(
      page.getByText(/Ranked play in Junior debates pauses/),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close season' }).click();
    await expect(page.getByText(/^Closed · Started/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open season' })).toBeVisible();
    await page.goto('/leaderboard');
    await page.getByRole('link', { name: 'Junior debates' }).click();
    await expect(
      page.getByText('Inaugural season', { exact: false }).first(),
    ).toBeVisible();
  } finally {
    await run('standing-lobby-host-process.ts', 'close', handle);
    for (const flag of flags)
      await run('release-flag-process.ts', flag, 'default');
  }
});
