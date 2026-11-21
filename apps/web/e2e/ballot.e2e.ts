import { overflowing } from './support/ballot-layout-probes';
import { proveBallotRecovery } from './support/ballot-recovery-proof';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { createHumanBallotRound } from './support/human-ballot-round';
import { type Page } from '@playwright/test';
import { expect, test, openPage } from './support/fixtures';
import { assertNoSeriousFindings } from './support/axe';
import { humanBallotFixtures } from './support/human-ballot-fixtures';
import { expectNotInUrl } from './support/forms';
import { effectsRan, holdScripts } from './support/hydration';
import { controlLaunch } from './support/room-launch-settled';
import { gotoWithTheme } from './support/theme';
import { RAIL_COOKIE } from '../src/ui/layout/app-shell/rail-preference';

/**
 * The judge's ballot (ISSUE-348): one real POST that works before and after
 * hydration, keeps everything entered when it is refused, and is usable on
 * a phone. The finished debate shows both judges' ballots.
 */
test.describe('actual frozen human ballots', () => {
  let fixtures: Awaited<ReturnType<typeof humanBallotFixtures>>;
  let ballotUrl = '',
    affirmativeName = '',
    negativeName = '';
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(210_000);
    fixtures = await humanBallotFixtures(browser);
    affirmativeName = fixtures.affirmative;
    negativeName = fixtures.negative;
  });
  test.afterAll(async () => {
    await fixtures?.closeContexts();
  });
  test.beforeEach(async ({ page }, info) => {
    await page
      .context()
      .addCookies(await fixtures.members[2]!.context.cookies());
    const path = info.titlePath.join(' ');
    const index = path.includes('a refusal keeps everything') ? 1 : 0;
    ballotUrl = `/judge/ballot/${fixtures.rounds[index]!.id}`;
  });

  const submit = (page: Page) =>
    page.getByRole('button', { name: 'Submit ballot' }).click();
  const pick = (page: Page, name: string) =>
    page.locator('label', { hasText: name }).first().click();
  const radio = (page: Page, name: string) =>
    page.getByRole('radio', { name: new RegExp(name) });
  const slider = (page: Page, category: string, name: string) =>
    page.getByLabel(`${category}, ${name}`);

  test('a refusal keeps everything, a low-point win asks first, then it submits', async ({
    page,
  }) => {
    await page.goto(ballotUrl);
    await pick(page, negativeName);
    await slider(page, 'Thesis', affirmativeName).fill('5');
    await page.getByLabel(`Feedback for ${affirmativeName}`).fill('Slow down.');
    await submit(page);

    // No reason: refused, and everything entered comes back.
    await expect(page.locator('#round-ballot-refusal')).toHaveText(
      'Write the reason for your decision.',
    );
    // The refusal heads the form, so the reloaded page shows it at once.
    await expect(page.locator('#round-ballot-refusal')).toBeInViewport();
    await expect(radio(page, negativeName)).toBeChecked();
    await expect(slider(page, 'Thesis', affirmativeName)).toHaveValue('5');
    await expect(
      page.getByLabel(`Feedback for ${affirmativeName}`),
    ).toHaveValue('Slow down.');
    await expect(page.locator('#round-ballot-refusal')).toBeFocused();

    // Daniel wins on 30 to 32: the ballot asks for a confirmation.
    const reason = 'Daniel weighed his impacts; Maya did not answer them.';
    await page.getByLabel('Reason for decision').fill(reason);
    await submit(page);
    await expect(page.locator('#round-ballot-refusal')).toHaveText(
      'Confirm the low-point win, or change the scores.',
    );
    await expect(
      page.getByText(`${negativeName} wins with fewer points: 30 to 32`),
    ).toBeVisible();
    await expect(radio(page, negativeName)).toBeChecked();
    await expect(page.getByLabel('Reason for decision')).toHaveValue(reason);

    await page.getByLabel('Confirm the decision').check();
    await submit(page);
    await expect(page).toHaveURL(ballotUrl);
    await expect(page.getByText('Ballot submitted')).toBeVisible();
    expectNotInUrl(page, reason);
  });

  test('input made before hydration is kept, shown and posted', async ({
    page,
  }) => {
    const path = `/judge/ballot/${fixtures.rounds[4]!.id}`;
    const release = await holdScripts(page);
    // The held chunks keep the load events from firing; wait for the markup.
    await page.goto(path, { waitUntil: 'commit' });
    await expect(slider(page, 'Delivery', negativeName)).toBeVisible();
    await pick(page, negativeName);
    await slider(page, 'Thesis', affirmativeName).fill('5');
    const feedback = page.getByLabel(`Feedback for ${affirmativeName}`);
    await feedback.fill('Slow down.');
    release();

    // The read-outs start from the controls, not from a fresh sheet.
    await expect(
      page.locator('p', { hasText: `Your vote: ${negativeName} wins` }),
    ).toBeVisible();
    await expect(
      page.getByText(`${negativeName} wins with fewer points: 30 to 32`),
    ).toBeVisible();

    // A later change leaves the earlier input alone, and the refusal keeps it.
    await slider(page, 'Delivery', negativeName).fill('4');
    await expect(radio(page, negativeName)).toBeChecked();
    const reasonField = page.getByLabel('Reason for decision');
    await reasonField.fill('A close round.');
    const refusal = page.locator('#round-ballot-refusal');
    const lowPoint = 'Confirm the low-point win, or change the scores.';
    const command = page.locator(
      'form[aria-label="Your ballot"] input[name="commandId"]',
    );
    const originalCommand = await command.inputValue();
    await submit(page);
    await expect(refusal).toHaveText(lowPoint);
    await expect(slider(page, 'Delivery', affirmativeName)).toBeVisible();

    const reason = 'The negative compared the decisive impacts.';
    await reasonField.fill(reason);
    const expectEntries = async () => {
      await expect(refusal).toHaveText(lowPoint);
      await expect(command).toHaveValue(originalCommand);
      await expect(radio(page, negativeName)).toBeChecked();
      await expect(slider(page, 'Thesis', affirmativeName)).toHaveValue('5');
      await expect(slider(page, 'Delivery', negativeName)).toHaveValue('4');
      await expect(feedback).toHaveValue('Slow down.');
      await expect(reasonField).toHaveValue(reason);
    };
    const rail = page.getByRole('navigation', { name: 'Primary' });
    await expect(rail.getByRole('button', { name: 'Minimize' })).toBeVisible();
    await controlLaunch('refuse-challenge-reads');
    try {
      // Force the shell read refusal observed during the Launch-1 refresh.
      const challengeRead = await page.request.get('/api/challenges');
      expect(challengeRead.status()).toBe(503);
      // The new rail label shows when React has applied the refreshed shell.
      await page
        .context()
        .addCookies([
          { name: RAIL_COOKIE, value: 'mini', url: new URL(page.url()).origin },
        ]);
      const refresh = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === path &&
          response.request().headers()['rsc'] === '1',
        { timeout: 15_000 },
      );
      await page
        .getByRole('link', { name: 'Refresh Round', exact: true })
        .click();
      expect((await refresh).status()).toBe(200);
      await expect(rail.getByRole('button', { name: 'Expand' })).toBeVisible();
      await expectEntries();
      const repost = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === path &&
          response.request().method() === 'POST' &&
          Boolean(response.request().headers()['next-action']),
        { timeout: 15_000 },
      );
      await submit(page);
      expect((await repost).status()).toBe(200);
      await expectEntries();
      await expect(refusal).toBeFocused();
      await expect(slider(page, 'Delivery', affirmativeName)).toBeVisible();
      await expect(page.getByLabel('Confirm the decision')).toBeVisible();
    } finally {
      await controlLaunch('allow-challenge-reads');
    }

    await page.getByLabel('Confirm the decision').check();
    await submit(page);
    await expect(page).toHaveURL(path);
    await expect(page.getByText('Ballot submitted')).toBeVisible();
    const recorded = page.getByRole('region', { name: 'Your recorded ballot' });
    await expect(
      recorded.getByText(`Voted ${negativeName}`, { exact: true }),
    ).toBeVisible();
    await expect(recorded.getByText(reason, { exact: true })).toBeVisible();
    const recordedFeedback = recorded.getByRole('listitem');
    await expect(recordedFeedback).toContainText(affirmativeName);
    await expect(recordedFeedback).toContainText('Slow down.');
    expectNotInUrl(page, reason);
  });

  test('no winner: the refusal names both debaters', async ({ page }) => {
    await page.goto(ballotUrl);
    await page.getByLabel('Reason for decision').fill('A close round.');
    await submit(page);
    await expect(page.locator('#round-ballot-refusal')).toHaveText(
      `Pick who won: ${affirmativeName} or ${negativeName}.`,
    );
  });

  const sheet = (page: Page) =>
    page.locator('section[aria-labelledby="ballot-scores"]');

  for (const width of [320, 360, 641, 768, 1024, 1280]) {
    // Beside the 56 px rail, from 768 px the sheet has room to set both sides
    // beside the category; below it, and on a phone, one row per side.

    test(`at ${width} px every slider is usable and the names are whole`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 780 });
      await page.goto(ballotUrl);
      const boxes = [];
      for (const name of [affirmativeName, negativeName]) {
        const box = await slider(page, 'Delivery', name).boundingBox();
        // Five stops a thumb can tell apart: at least 20 px each.
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(100);
        boxes.push(box);
        const label = page.locator('label', { hasText: name }).first();
        await expect(label.getByText(name, { exact: true })).toBeVisible();
        const fits = await label
          .getByText(name, { exact: true })
          .evaluate((node) => node.scrollWidth <= node.clientWidth);
        expect(fits).toBe(true);
      }
      // Observe the actual score row's container layout instead of guessing from viewport width.
      const wide = await slider(page, 'Delivery', affirmativeName).evaluate(
        (node) => {
          const row = node.closest('div.grid');
          if (!row) throw new Error('Actual score grid missing');
          return (
            getComputedStyle(row).gridTemplateColumns.split(' ').length === 4
          );
        },
      );
      expect(Math.abs((boxes[0]?.y ?? 0) - (boxes[1]?.y ?? 0)) < 2).toBe(wide);
      // Every name, number and "/ 50" sits inside its own cell.
      expect(await overflowing(sheet(page), 'label, p')).toEqual([]);
      // Scanned with a winner picked, so the unpicked card is in the scan too.
      await pick(page, negativeName);
      await assertNoSeriousFindings(page);
    });
  }

  for (const width of [320, 360, 390, 768, 920, 1024, 1280, 1440]) {
    test(`stored ballot scores remain whole at ${width} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/judge/ballot/${fixtures.rounds[2]!.id}`);
      const table = page.getByRole('table', { name: 'Your recorded scores' });
      await expect(table).toBeVisible();
      for (const name of [affirmativeName, negativeName])
        await expect(
          table.getByRole('columnheader', { name, exact: true }),
        ).toHaveCount(1);
      await expect(table.getByRole('row').last().getByRole('cell')).toHaveCount(
        2,
      );
      expect(await overflowing(table, 'td, th')).toEqual([]);
      await expect(
        page.getByText('Round outcome:', { exact: false }),
      ).toHaveCount(0);
      await assertNoSeriousFindings(page);
    });
  }

  test('a confirmation given for one result is dropped when the result changes', async ({
    page,
  }) => {
    await page.goto(ballotUrl);
    await pick(page, negativeName);
    await slider(page, 'Thesis', affirmativeName).fill('5');
    const confirm = page.getByLabel('Confirm the decision');
    await confirm.check();
    await submit(page);
    // Refused for the reason; the confirmation for 30 to 32 comes back ticked.
    await expect(page.locator('#round-ballot-refusal')).toHaveText(
      'Write the reason for your decision.',
    );
    await expect(confirm).toBeChecked();
    // A different low-point result asks again, and the server agrees.
    await expect(slider(page, 'Delivery', affirmativeName)).toBeVisible();
    await slider(page, 'Delivery', affirmativeName).fill('5');
    await expect(
      page.getByText(`${negativeName} wins with fewer points: 30 to 34`),
    ).toBeVisible();
    await expect(confirm).not.toBeChecked();
    await page.getByLabel('Reason for decision').fill('A close round.');
    await submit(page);
    await expect(page.locator('#round-ballot-refusal')).toHaveText(
      'Confirm the low-point win, or change the scores.',
    );
  });

  test('the ballot and the result pass axe in the light theme', async ({
    page,
  }) => {
    await gotoWithTheme(page, ballotUrl, 'light');
    await pick(page, negativeName);
    await assertNoSeriousFindings(page);
    await gotoWithTheme(
      page,
      `/judge/ballot/${fixtures.rounds[2]!.id}`,
      'light',
    );
    await expect(
      page.getByRole('table', { name: 'Your recorded scores' }),
    ).toBeVisible();
    await assertNoSeriousFindings(page);
  });
  test('once the speeches end the judge room offers the ballot and passes axe', async ({
    page,
  }) => {
    // Round 4 is frozen and never judged by any other test here.
    const roundId = fixtures.rounds[3]!.id;
    await page.goto(`/rounds/${roundId}/room`);
    await expect(
      page.getByRole('heading', { name: 'The speeches are over' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Open your ballot' }),
    ).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(1);
    await assertNoSeriousFindings(page);
  });
  test('a reload keeps what the judge entered in this tab', async ({
    page,
  }) => {
    await page.goto(`/judge/ballot/${fixtures.rounds[3]!.id}`);
    await effectsRan(page);
    await pick(page, negativeName);
    await page.getByLabel('Reason for decision').fill('Kept through a reload.');
    await page.reload();
    await effectsRan(page);
    await expect(page.getByLabel('Reason for decision')).toHaveValue(
      'Kept through a reload.',
    );
    await expect(radio(page, negativeName)).toBeChecked();
  });
  test('a committed lost acknowledgement keeps the exact ballot reachable after a fresh terminal read', async ({
    page,
  }) => {
    await proveBallotRecovery(page, fixtures);
  });
});

test('actual assigned Round waits for its frozen input and query strings cannot invent a submitted ballot', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 4);
  try {
    const round = await createHumanBallotRound(accounts.members);
    const judge = accounts.members[2]!;
    const judgePage = await openPage(judge.context, 'actual assigned judge');
    await judgePage.goto('/judge');
    await expect(
      judgePage.getByText('Cities should fund transit', { exact: true }),
    ).toBeVisible();
    // Follow enters the live Round as one document load, carrying the media
    // page's own Permissions-Policy: a client-side entry would be reloaded
    // by MediaDocument and record a 'reload' (ISSUE-565).
    await judgePage
      .getByRole('region', { name: 'Assigned to you' })
      .getByRole('link', { name: 'Follow', exact: true })
      .click();
    await expect(judgePage).toHaveURL(`/rounds/${round.id}/room`);
    await expect
      .poll(() =>
        judgePage.evaluate(() => {
          const entry = performance.getEntriesByType('navigation')[0] as
            PerformanceNavigationTiming | undefined;
          return entry && { type: entry.type, url: entry.name };
        }),
      )
      .toEqual({
        type: 'navigate',
        url: new URL(`/rounds/${round.id}/room`, judgePage.url()).href,
      });
    // The judge follows the Round from their seat: where it is now, the
    // speech order, one main landmark, and nothing axe calls serious.
    await expect(judgePage.locator('#judge-now')).toBeVisible();
    await expect(
      judgePage.getByRole('list', { name: 'Speech order' }),
    ).toBeVisible();
    await expect(judgePage.getByRole('main')).toHaveCount(1);
    await assertNoSeriousFindings(judgePage);
    await judgePage.goto(`/judge/ballot/${round.id}?state=submitted`);
    await expect(
      judgePage.getByRole('heading', { name: 'How this ballot works' }),
    ).toBeVisible();
    await expect(
      judgePage.getByText(
        'Your ballot opens when the recorded transcript is frozen.',
      ),
    ).toBeVisible();
    await expect(
      judgePage.getByRole('button', { name: 'Submit ballot' }),
    ).toHaveCount(0);
    await expect(
      judgePage.getByText('Ballot submitted.', { exact: false }),
    ).toHaveCount(0);
    const debater = accounts.members[1]!;
    const unassigned = await openPage(
      debater.context,
      'actual unassigned member',
    );
    await unassigned.goto('/judge');
    await expect(
      unassigned.getByRole('heading', { name: 'No assigned Rounds' }),
    ).toBeVisible();
    const protectedRead = await debater.context.request.get(
      `/api/rounds/${round.id}/ballots`,
    );
    expect(protectedRead.status()).toBe(200);
    const blind = await protectedRead.json();
    expect(blind.own).toBeNull();
    expect(blind.freeze).toBeNull();
    expect(JSON.stringify(blind)).not.toContain(judge.username);
  } finally {
    await accounts.closeContexts();
  }
});
