import type { Browser, Page } from '@playwright/test';
import { createId } from '@paralleldrive/cuid2';
import { expect, openPage } from './fixtures';
import { origin, signUpWaitlisted } from './accounts';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import { createFromPlay } from './room-launch-flow';
import { expectRoundResult } from './round-result-proof';
import {
  assemble,
  judgeBallot,
  launch,
  openThreePlayers,
  playEveryTurn,
  readRound,
  skipPreRoundPrep,
  type Player,
} from './three-browser-journey';

/**
 * ISSUE-639 clause 1, the part this suite can prove: a member still on the
 * beta list is denied participant pages and commands. Their approval through
 * the real signed operator API is ISSUE-685's cross-app harness (the Access
 * & admin slice); until it lands, that approval is a missing producer, never
 * stood in for here.
 */
async function provePendingDenied(browser: Browser) {
  const context = await browser.newContext({ baseURL: origin });
  try {
    await signUpWaitlisted(context.request);
    const page = await openPage(context, 'ISSUE-639 pending member');
    await page.goto('/play');
    await expect(page).toHaveURL(/\/beta\?next=%2Fplay$/);
    const create = await context.request.post('/api/rooms', {
      headers: { origin },
      data: {},
    });
    expect(create.status()).toBe(403);
  } finally {
    await context.close();
  }
}

/** A member joins the host's Room from the Lobby's own row, as anyone would. */
async function joinFromLobby(page: Page, title: string, roomId: string) {
  await page.goto('/lobby');
  await page.getByRole('link', { name: `Join: ${title}`, exact: true }).click();
  await expect(page).toHaveURL(`/rooms/${roomId}`);
}

/** The same durable Round in a member's own profile history. */
async function expectInHistory(page: Page, username: string, roundId: string) {
  await page.goto(`/profile/${username}`);
  await expect(
    page
      .getByRole('region', { name: 'Match history' })
      .locator(`a[href="/rounds/${roundId}"]`),
  ).toHaveCount(1);
}

/**
 * ISSUE-639, the unranked beta MVP journey as one proof:
 * - clause 1: the beta gate denies a pending member (approval: ISSUE-685);
 * - clause 2: two approved members meet through the Lobby, play a standard
 *   one-on-one Round to a human ballot, read the authorized result and
 *   transcript, and find the same Round in their profile history.
 * Clause 3 (Freestyle strike and reveal) has no producer on main; clause 4
 * (friends, Challenge, DM) is the Social slice's seam. Both are recorded in
 * the evidence as missing, never replaced by a mock.
 */
export async function proveMvpJourney(browser: Browser) {
  await provePendingDenied(browser);
  const accounts = await createRoomLaunchAccounts(browser, 3);
  try {
    const [aff, neg, judge] = await openThreePlayers(
      accounts.members,
      'ISSUE-639',
    );
    const title = `ISSUE-639 ${createId().slice(0, 8)}`;
    let room = await createFromPlay(aff, title, 'one-on-one');
    for (const page of [neg, judge]) await joinFromLobby(page, title, room.id);
    const players: Player[] = [
      { page: aff, seat: 'Affirmative 1' },
      { page: neg, seat: 'Negative 1' },
      { page: judge, seat: 'Judge 1' },
    ];
    room = await skipPreRoundPrep(aff, room);
    room = await assemble(players, room);
    const { roundId } = await launch(aff);
    for (const page of [neg, judge])
      await page.getByRole('link', { name: 'View the round' }).click();
    const played = await playEveryTurn(
      { affirmative: aff, negative: neg },
      {
        affirmative: accounts.members[0]!.context,
        negative: accounts.members[1]!.context,
      },
      roundId,
      () => {},
    );
    await judgeBallot(judge, roundId);
    for (const page of [played.affirmative, played.negative])
      await page.goto(`/rounds/${roundId}`);
    await judge.goto(`/rounds/${roundId}`);
    await expectRoundResult(
      { debaters: [played.affirmative, played.negative], judge: judge },
      'Result · Negative won',
    );
    const finished = await readRound(played.affirmative, roundId);
    expect([finished.status, finished.outcome]).toEqual([
      'completed',
      'negative',
    ]);
    await expectInHistory(
      played.affirmative,
      accounts.members[0]!.username,
      roundId,
    );
    await expectInHistory(
      played.negative,
      accounts.members[1]!.username,
      roundId,
    );
  } finally {
    await accounts.closeContexts();
  }
}
