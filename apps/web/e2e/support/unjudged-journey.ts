import type { Browser, BrowserContext } from '@playwright/test';
import { roundBallotReadSchema } from '@daisy/protocol';
import { expect, openPage } from './fixtures';
import { origin } from './accounts';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import { readBallotRound } from './human-ballot-round';
import { playActualSpeeches } from './human-judged-journey';

/** DEC-191 without a fixture clock, maintenance callback, ballot or outcome. */
export async function proveUnjudgedJourney(browser: Browser) {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  let native: BrowserContext | undefined;
  try {
    const [aff, neg] = accounts.members as [
      (typeof accounts.members)[number],
      (typeof accounts.members)[number],
    ];
    const view = await playActualSpeeches(accounts.members, 0);
    expect(view.participants.some((p) => p.role === 'judge')).toBe(false);
    const room = await openPage(aff.context, 'enhanced unjudged debater');
    await room.goto(`/rounds/${view.id}/room`);
    await expect(
      room.getByText('Finished', { exact: true }).first(),
    ).toBeVisible();
    await expect(room.getByText('Judging', { exact: false })).toHaveCount(0);
    await expect(async () => {
      const round = await readBallotRound(neg.context.request, view.id);
      expect([round.status, round.outcome]).toEqual(['completed', null]);
    }).toPass({ timeout: 160_000 });
    await expect(room).toHaveURL(`/rounds/${view.id}`, { timeout: 15_000 });
    await expect(
      room.getByText('Result · Unjudged', { exact: true }),
    ).toBeVisible();
    const ballots = await neg.context.request.get(
      `/api/rounds/${view.id}/ballots`,
    );
    expect(ballots.status()).toBe(200);
    const read = roundBallotReadSchema.parse(await ballots.json());
    expect([read.ballots.length, read.own, read.freeze]).toEqual([
      0,
      null,
      null,
    ]);
    native = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      javaScriptEnabled: false,
      storageState: await neg.context.storageState(),
    });
    const receipt = await openPage(native, 'native unjudged receipt');
    await receipt.goto(`/rounds/${view.id}`);
    const header = receipt.getByRole('main').locator('header');
    await expect(
      header.getByText('Result · Unjudged', { exact: true }),
    ).toBeVisible();
    await expect(header).toContainText('Round · Finished');
    for (const untrue of ['Draw', 'Abandoned', 'won', 'ballot'])
      await expect(header).not.toContainText(untrue);
  } finally {
    await native?.close();
    await accounts.closeContexts();
  }
}
