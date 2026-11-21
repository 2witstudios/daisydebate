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

  try {
    await run('release-flag-process.ts', 'host-tiers', 'default');
    await run('release-flag-process.ts', 'daisy-tab', 'enabled');
    await run('standing-lobby-host-process.ts', 'create', handle, username);
    await page.goto('/host');
    await expect(
      page.getByRole('heading', { name: 'Not found' }),
    ).toBeVisible();
    await page.goto('/tournaments');
    await page.getByRole('link', { name: 'Browse tournaments' }).click();
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
    await page
      .getByRole('list', { name: 'Debate destinations' })
      .getByRole('link', { name: /^Play\b/ })
      .click();
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
    const phoneRail = page.getByRole('navigation', {
      name: 'Southeast League',
    });
    await expect(
      phoneRail.getByRole('link', { name: 'League', exact: true }),
    ).toBeVisible();
    await expect(
      phoneRail.getByRole('link', { name: 'People', exact: true }),
    ).toBeVisible();
    const railBox = await phoneRail.boundingBox();
    const firstCard = await page
      .getByRole('heading', { name: 'Ladders' })
      .boundingBox();
    expect(
      railBox && firstCard && railBox.y + railBox.height < firstCard.y,
    ).toBe(true);

    const editLobby = async (name: string) => {
      await page.getByRole('link', { name: 'Edit lobby' }).click();
      await page.getByLabel('Name', { exact: true }).fill(name);
      await page.getByLabel('Who can debate').selectOption('anyone');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(
        page.getByRole('heading', { name, exact: true }),
      ).toBeVisible();
    };
    const longName = `Junior debate ${'x'.repeat(105)}`;
    await editLobby(longName);
    for (const path of ['/lobby?view=rooms', '/watch', '/leaderboard']) {
      await page.goto(path);
      const option = page
        .getByRole('navigation', { name: 'Lobby', exact: true })
        .getByRole('link', { name: longName, exact: true });
      await expect(option).toBeVisible();
      await option.click();
      await expect(option).toHaveAttribute('aria-current', 'page');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390);
    }
    await page.goto(management);
    await editLobby('Junior debates');

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
    await run('release-flag-process.ts', 'daisy-tab', 'default');
  }
});
