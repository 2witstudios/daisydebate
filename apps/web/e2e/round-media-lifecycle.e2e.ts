import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { roundMediaStateSchema } from '@daisy/protocol';
import { test, expect, openPage } from './support/fixtures';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { createLaunchContexts } from './support/room-launch-contexts';
import {
  origin,
  signUpMember,
  requestSignInLink,
  confirmSignIn,
  emailedLink,
} from './support/accounts';
import { closeSettledLaunchContexts } from './support/room-launch-settled';
import {
  createFoundationRoom,
  createHumanBallotRound,
  readBallotRound,
  seatAndReady,
  startAdmittedRound,
} from './support/human-ballot-round';
import { humanRoundSelection } from './support/human-round-selection';
import { settleLeftRounds } from './support/settle-left-round';
import {
  MEDIA_POLL,
  afterHydration,
  grantMedia,
  expectConnected,
  openCheckedMediaRound,
  openGrantedRound,
} from './support/round-media';

test('closing an account leaves no live Round behind it', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const round = await createHumanBallotRound(accounts.members, 0);
    await accounts.closeContexts();
    // The Round's own read belongs to its seats, and they have just left.
    const finished = await new Promise<string>((resolve, reject) =>
      execFile(
        'bun',
        [
          fileURLToPath(
            new URL('./support/round-status-process.ts', import.meta.url),
          ),
          round.id,
        ],
        { timeout: 20_000 },
        (error, output) =>
          error
            ? reject(new Error('Round status read failed'))
            : resolve(output),
      ),
    );
    expect(finished).toBe('true');
  } finally {
    await accounts.closeContexts();
  }
});

test('canceled and unacknowledged leave retain recovery; acknowledged departure and terminal do not resume', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const { round, owner, page } = await openGrantedRound(
      accounts.members,
      'departure recovery',
    );
    const href = `/rounds/${round.id}/room`;
    await page.goto(href);
    await expectConnected(page);
    await page.getByRole('link', { name: 'Leave round', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Leave the round?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('link', { name: 'Stay', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.goto('/');
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expectConnected(page);
    await page.getByRole('link', { name: 'Leave round', exact: true }).click();
    const confirm = dialog.getByRole('button', {
      name: 'Leave and forfeit',
      exact: true,
    });
    const commandId = await confirm
      .locator('..')
      .locator('input[name=commandId]')
      .inputValue();
    let intercepted = false;
    await page.route(`**${href}`, async (route) => {
      const request = route.request();
      if (
        !intercepted &&
        request.method() === 'POST' &&
        request.headers()['next-action'] &&
        request.postData()?.includes(commandId)
      ) {
        intercepted = true;
        // Owned transport fault before dispatch: the browser cannot infer
        // acknowledgement and canonical membership is still active.
        await route.fulfill({
          status: 503,
          contentType: 'text/plain',
          body: 'Unavailable acknowledgement',
        });
      } else await route.continue();
    });
    await confirm.click();
    await expect(
      dialog.getByText(
        'The command is not acknowledged. Review the current round before trying again.',
        { exact: true },
      ),
    ).toBeVisible();
    expect(intercepted).toBe(true);
    expect(
      (await readBallotRound(owner.context.request, round.id)).status,
    ).not.toBe('completed');
    await page.unroute(`**${href}`);
    await dialog.getByRole('link', { name: 'Stay', exact: true }).click();
    await page.goto('/lobby');
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expectConnected(page);
    const local = await page
      .getByLabel('Your camera', { exact: true })
      .evaluateHandle(
        (node) =>
          (
            (node as HTMLVideoElement).srcObject as MediaStream
          ).getVideoTracks()[0]!,
      );
    await page.getByRole('link', { name: 'Leave round', exact: true }).click();
    await dialog
      .getByRole('button', { name: 'Leave and forfeit', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/rounds/${round.id}$`));
    await expect
      .poll(() => local.evaluate((track) => track.readyState), MEDIA_POLL)
      .toBe('ended');
    await local.dispose();
    for (const entry of ['/', '/lobby']) {
      await page.goto(entry);
      await expect(page).toHaveURL(
        new RegExp(`${entry === '/' ? '/$' : '/lobby$'}`),
      );
      await expect(page.getByLabel('Your camera', { exact: true })).toHaveCount(
        0,
      );
    }
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('actual sign-out and emailed sign-in return to the authorized live Round', async ({
  browser,
}) => {
  const emails: string[] = [];
  const accounts = await createLaunchContexts(
    2,
    () => browser.newContext({ baseURL: origin, ignoreHTTPSErrors: false }),
    async (context) => {
      const member = await signUpMember(context.request);
      emails.push(member.email);
      return member;
    },
  );
  try {
    await grantMedia(accounts.members);
    const { round, pages } = await openCheckedMediaRound(accounts.members, () =>
      Promise.resolve(),
    );
    const owner = accounts.members[0]!;
    const page = pages[0]!;
    const href = `/rounds/${round.id}/room`;
    await expectConnected(page);
    const checkedRecords = () =>
      page.evaluate(
        () =>
          Object.keys(sessionStorage).filter((key) =>
            key.startsWith('daisy:checked-devices:'),
          ).length,
      );
    expect(await checkedRecords()).toBe(1);
    await page.goto('/settings/security');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    expect(await checkedRecords()).toBe(0);
    await page.goto(href);
    await expect(page).toHaveURL(/\/sign-in/);
    await requestSignInLink(page, emails[0]!);
    await confirmSignIn(
      page,
      await emailedLink(owner.context.request, emails[0]!),
    );
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expectConnected(page);
    await expect(page.getByLabel('Your camera', { exact: true })).toBeVisible(
      MEDIA_POLL,
    );
    const response = await owner.context.request.get(
      `/api/rounds/${round.id}/media`,
    );
    expect(response.status()).toBe(200);
    expect(
      roundMediaStateSchema.parse(await response.json()).grants.subscribe,
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath('signed-in-round-recovery.png'),
    });
  } finally {
    await settleLeftRounds(accounts.members);
    await closeSettledLaunchContexts(accounts);
  }
});

test('a mute choice survives this tab’s reload and never reaches a fresh tab', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const [host, opponent] = accounts.members;
    if (!host || !opponent) throw new Error('Two actual members required');
    let room = await createFoundationRoom(host, (choice) => {
      const selection = humanRoundSelection(choice, 0);
      return {
        ...selection,
        definition: {
          ...selection.definition,
          configurable: {
            ...selection.definition.configurable,
            interaction: {
              ...selection.definition.configurable.interaction,
              interruptions: {
                modes: ['disabled', 'open'],
                minRemainingMs: { min: 0, max: 300_000 },
              },
            },
          },
        },
        config: {
          ...selection.config,
          interruptions: { mode: 'open', minRemainingMs: 0 },
        },
      } as typeof selection;
    });
    room = await seatAndReady(room, [
      { member: host, role: 'affirmative', slot: 0 },
      { member: opponent, role: 'negative', slot: 0 },
    ]);
    const round = await startAdmittedRound(host, room);
    await grantMedia(accounts.members);
    const page = await openPage(host.context, 'mute owner');
    const href = `/rounds/${round.id}/room`;
    await page.goto(href);
    await expectConnected(page);
    await page
      .getByRole('button', { name: 'Unmute microphone', exact: true })
      .click();
    const mute = page.getByRole('button', {
      name: 'Mute microphone',
      exact: true,
    });
    await expect(mute).toBeVisible(MEDIA_POLL);
    await page.reload();
    await expectConnected(page);
    await expect(mute).toBeVisible(MEDIA_POLL);
    await page.close();
    const fresh = await openPage(host.context, 'fresh tab default');
    await fresh.goto(href);
    await expectConnected(fresh);
    await expect(
      fresh.getByRole('button', { name: 'Unmute microphone', exact: true }),
    ).toBeVisible(MEDIA_POLL);
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('home and lobby resume only a seated member; an outsider keeps browsing', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 3);
  try {
    const round = await createHumanBallotRound(accounts.members.slice(0, 2), 0);
    const outsider = await openPage(
      accounts.members[2]!.context,
      'unseated member',
    );
    for (const entry of ['/', '/lobby']) {
      await outsider.goto(entry);
      await expect(outsider.getByRole('navigation').first()).toBeVisible();
      await expect(outsider).toHaveURL(
        new RegExp(`${entry === '/' ? '/$' : '/lobby$'}`),
      );
    }
    const seated = await openPage(
      accounts.members[1]!.context,
      'seated member',
    );
    await seated.goto('/settings/security');
    await expect(seated).toHaveURL(/\/settings\/security$/);
    await seated.goto('/lobby');
    await expect(seated).toHaveURL(new RegExp(`/rounds/${round.id}/room$`));
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('a seatless host watches and leaves freely; a seated judge resumes and can still go', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 4);
  try {
    const [host, affirmative, negative, judge] = accounts.members;
    if (!host || !affirmative || !negative || !judge)
      throw new Error('Four actual members required');
    // The judge's Round: everyone holds a seat, and the host is the affirmative.
    const judged = await createHumanBallotRound(
      [affirmative, negative, judge, host],
      2,
    );
    const judgePage = await openPage(judge.context, 'seated judge');
    await judgePage.goto('/lobby');
    await expect(judgePage).toHaveURL(new RegExp(`/rounds/${judged.id}/room$`));
    await judgePage
      .getByRole('link', { name: 'Back to the lobby', exact: true })
      .click();
    await expect(judgePage).toHaveURL(/\/lobby$/);
    await judgePage.goto('/');
    await afterHydration(judgePage);
    await expect(judgePage).toHaveURL(/\/$/);
    // Coming back undoes that choice, so resume works again in this tab.
    await judgePage.goto(`/rounds/${judged.id}/room`);
    await afterHydration(judgePage);
    await judgePage.goto('/lobby');
    await expect(judgePage).toHaveURL(new RegExp(`/rounds/${judged.id}/room$`));
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
  const hosting = await createRoomLaunchAccounts(browser, 3);
  try {
    const [host, affirmative, negative] = hosting.members;
    if (!host || !affirmative || !negative)
      throw new Error('Three actual members required');
    let room = await createFoundationRoom(host, (choice) =>
      humanRoundSelection(choice, 0),
    );
    room = await seatAndReady(room, [
      { member: affirmative, role: 'affirmative', slot: 0 },
      { member: negative, role: 'negative', slot: 0 },
    ]);
    const round = await startAdmittedRound(host, room);
    const page = await openPage(host.context, 'seatless host');
    await page.goto(`/rounds/${round.id}/room`);
    await page
      .getByRole('link', { name: 'Back to the lobby', exact: true })
      .click();
    await expect(page).toHaveURL(/\/lobby$/);
    await page.goto('/');
    await afterHydration(page);
    await expect(page).toHaveURL(/\/$/);
  } finally {
    await closeSettledLaunchContexts(hosting);
  }
});

test('a waiting home tab reads again when its Round ends, instead of entering it', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const {
      round,
      owner,
      page: active,
    } = await openGrantedRound(accounts.members, 'forfeiting owner');
    await active.goto(`/rounds/${round.id}/room`);
    await expectConnected(active);
    const waiting = await openPage(owner.context, 'waiting home tab');
    await waiting.goto('/');
    await expect(
      waiting.getByRole('button', { name: 'Use this tab', exact: true }),
    ).toBeVisible();
    await active
      .getByRole('link', { name: 'Leave round', exact: true })
      .click();
    await active
      .getByRole('dialog', { name: 'Leave the round?' })
      .getByRole('button', { name: 'Leave and forfeit', exact: true })
      .click();
    await expect(active).toHaveURL(new RegExp(`/rounds/${round.id}$`));
    await expect(
      waiting.getByRole('button', { name: 'Use this tab', exact: true }),
    ).toHaveCount(0, MEDIA_POLL);
    await expect(waiting).toHaveURL(/\/$/);
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('a resume that landed on a failing Round page does not fire again until the page renders', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const { round, page } = await openGrantedRound(
      accounts.members,
      'resume onto a failing page',
    );
    const href = `/rounds/${round.id}/room`;
    await page.goto(href);
    await expectConnected(page);
    let attempts = 0;
    await page.route(`**${href}`, (route) => {
      if (route.request().resourceType() !== 'document')
        return route.fallback();
      attempts++;
      return route.fulfill({ status: 500, body: 'Round page failing' });
    });
    await page.goto('/');
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    expect(attempts).toBe(1);
    for (const entry of ['/lobby', '/']) {
      await page.goto(entry);
      await afterHydration(page);
      // The trap fires from an effect, so hold past when it would have run.
      await page.waitForTimeout(1_000);
      await expect(page).toHaveURL(
        new RegExp(`${entry === '/' ? '/$' : '/lobby$'}`),
      );
    }
    expect(attempts).toBe(1);
    await page.unroute(`**${href}`);
    await page.goto(href);
    await expectConnected(page);
    await page.goto('/');
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expectConnected(page);
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});
