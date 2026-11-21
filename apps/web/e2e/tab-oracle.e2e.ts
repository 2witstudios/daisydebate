import type { BrowserContext, Locator } from '@playwright/test';
import { origin, signUpMember } from './support/accounts';
import { expect, openPage, test } from './support/fixtures';
import { hydrated } from './support/hydration';
import {
  createOracleLeague,
  createTournamentInBrowser,
  readDraftPair,
  recordAdministrativeResult,
  registerTournamentCast,
  scheduleTournament,
  setTabFlag,
  startOracleRound,
} from './support/tab-oracle';

test.beforeAll(async () => {
  await setTabFlag('daisy-tab', 'enabled');
  await setTabFlag('host-tiers', 'enabled');
});
test.afterAll(async () => {
  await setTabFlag('host-tiers', 'default');
  await setTabFlag('daisy-tab', 'default');
});

test('a host takes a stored tournament from setup through entries, draw, ballot and results', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await signUpMember(page.request);
  const handle = await createTournamentInBrowser(
    page,
    'Oracle journey tournament',
  );
  const schedule = await scheduleTournament(page.request, handle);
  const cast = await registerTournamentCast(context, schedule);
  const base = `/host/tournaments/${handle}`;

  await page.getByRole('link', { name: 'Entries', exact: true }).click();
  for (const name of cast.entries)
    await expect(page.getByText(name, { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Draw', exact: true }).click();
  await page.getByRole('link', { name: 'Open round', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Oracle opening round' }),
  ).toBeVisible();
  const generate = page.getByRole('button', { name: 'Generate draw' });
  await hydrated(generate);
  await generate.click();
  const assign = page.getByRole('button', { name: 'Assign judges' });
  await hydrated(assign);
  await assign.click();
  await expect(page.getByText(cast.judge, { exact: false })).toBeVisible();
  const pair = await readDraftPair(page.request, schedule);
  const publish = page.getByRole('button', { name: 'Publish round 1' });
  await hydrated(publish);
  await publish.click();
  await expect(page.getByRole('link', { name: 'Open room' })).toBeVisible();

  await page.goto(`${base}/events/${schedule.eventId}/ballot`);
  await expect(
    page.getByRole('heading', { name: `Ballot · ${schedule.eventName}` }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Entries already use this event, so its ballot cannot change.',
    ),
  ).toBeVisible();

  const screening = page.getByRole('combobox', { name: 'Screening' });
  await hydrated(screening);
  const screeningChoice =
    (await screening.inputValue()) === 'hold' ? 'off' : 'hold';
  await screening.selectOption(screeningChoice);
  const screeningSaved = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `${base}/events/${schedule.eventId}/ballot`,
  );
  await page.getByRole('button', { name: 'Save screening' }).click();
  expect((await screeningSaved).ok()).toBe(true);
  await page.reload();
  await expect(screening).toHaveValue(screeningChoice);

  await page.getByRole('link', { name: 'Results', exact: true }).click();
  await expect(
    page.getByText('Results are still being recorded.'),
  ).toBeVisible();
  await recordAdministrativeResult(page.request, schedule, pair);
  await page.reload();
  await expect(
    page.getByText('Current published results are ready to certify.'),
  ).toBeVisible();
  const certify = page.getByRole('button', { name: 'Certify current results' });
  await hydrated(certify);
  await certify.click();
  await expect(page.getByText('The event is certified.')).toBeVisible();
});

test('renders the ballot index with a stored Round', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await signUpMember(page.request);
  const handle = await createTournamentInBrowser(
    page,
    'Oracle ballot index tournament',
  );
  const schedule = await scheduleTournament(page.request, handle);
  const cast = await registerTournamentCast(context, schedule);
  const round = await startOracleRound(context, schedule, cast);
  const path = `/host/tournaments/${handle}/ballots`;
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(new URL(path, origin).href);
  const group = page.getByRole('link', {
    name: `${round.roomTitle} · Ballot group 1`,
    exact: true,
  });
  await expect(group).toBeVisible();
  await expect(group).toHaveAttribute(
    'href',
    `${path}?${new URLSearchParams({ event: schedule.eventId, round: round.roundId })}`,
  );
});

test.describe('stored host page rendering', () => {
  let storage: Awaited<ReturnType<BrowserContext['storageState']>>;
  let schedule: Awaited<ReturnType<typeof scheduleTournament>>;
  let league: Awaited<ReturnType<typeof createOracleLeague>>;
  let cast: Awaited<ReturnType<typeof registerTournamentCast>>;
  const tournamentName = 'Oracle render tournament';

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(120_000);
    const context = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
    });
    try {
      const page = await openPage(context, 'the stored host');
      const { username } = await signUpMember(page.request);
      const handle = await createTournamentInBrowser(page, tournamentName);
      schedule = await scheduleTournament(page.request, handle);
      cast = await registerTournamentCast(context, schedule);
      league = await createOracleLeague(page.request, username);
      storage = await context.storageState();
    } finally {
      await context.close();
    }
  });

  const cases = [
    { page: 'host directory', path: () => '/host', text: () => tournamentName },
    {
      page: 'draw overview',
      path: (base: string) => base,
      text: () => 'Oracle opening round',
    },
    {
      page: 'setup',
      path: (base: string) => `${base}/setup`,
      text: () => `${schedule.eventName} · 1 of 1`,
      body: (main: Locator) =>
        main
          .getByRole('listitem')
          .filter({ hasText: /^Rounds\s*1 preliminary rounds · /u }),
    },
    {
      page: 'events and schedule',
      path: (base: string) => `${base}/events?event=${schedule.eventId}`,
      text: () => 'Oracle opening round',
    },
    {
      page: 'round draw',
      path: (base: string) =>
        `${base}/events/${schedule.eventId}/rounds/${schedule.tabRoundId}`,
      text: () => 'Oracle opening round',
    },
    {
      page: 'entries',
      path: (base: string) => `${base}/entries`,
      text: () => cast.entries[0],
    },
    {
      page: 'judges',
      path: (base: string) => `${base}/judges`,
      text: () => cast.judge,
    },
    {
      page: 'people',
      path: (base: string) => `${base}/people`,
      text: () => 'You',
    },
    {
      page: 'event ballot',
      path: (base: string) => `${base}/events/${schedule.eventId}/ballot`,
      text: () => `Ballot · ${schedule.eventName}`,
    },
    {
      page: 'standings',
      path: (base: string) => `${base}/standings`,
      text: () => cast.entries[0],
      body: (main: Locator) =>
        main.getByRole('table').getByText(cast.entries[0], { exact: true }),
    },
    {
      page: 'results',
      path: (base: string) => `${base}/results`,
      text: () => `${schedule.eventName} · 1 of 1`,
      body: (main: Locator) =>
        main
          .getByRole('region', { name: 'Bracket', exact: true })
          .getByRole('heading', { name: /^Oracle opening round\b/u }),
    },
    {
      page: 'billing',
      path: (base: string) => `${base}/billing`,
      text: () => `${tournamentName} · Freestyle`,
    },
    {
      page: 'upgrade',
      path: (base: string) => `${base}/upgrade`,
      text: () =>
        `${tournamentName} · Freestyle. One payment for this event; nothing renews.`,
    },
    {
      page: 'league overview',
      path: () => `/host/leagues/${league.handle}`,
      text: () => 'Oracle league season',
    },
    {
      page: 'league people',
      path: () => `/host/leagues/${league.handle}/people`,
      text: () => 'You',
    },
  ];

  for (const screen of cases) {
    test(`renders ${screen.page} using stored data`, async ({ browser }) => {
      const context = await browser.newContext({
        baseURL: origin,
        ignoreHTTPSErrors: true,
        storageState: storage,
      });
      try {
        const page = await openPage(context, 'the stored host');
        const path = screen.path(`/host/tournaments/${schedule.handle}`);
        const response = await page.goto(path);
        expect(response?.status()).toBe(200);
        await expect(page).toHaveURL(new URL(path, origin).href);
        const main = page.getByRole('main');
        await expect(
          main.getByText(screen.text(), { exact: true }).first(),
        ).toBeVisible();
        if (screen.body) await expect(screen.body(main)).toBeVisible();
      } finally {
        await context.close();
      }
    });
  }
});
