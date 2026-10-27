import type { Browser, BrowserContext, Page } from '@playwright/test';
import { createId } from '@paralleldrive/cuid2';
import {
  attendanceTimingPolicy,
  isNamedSeat,
  roundViewSchema,
  type RoomView,
  type RoundView,
} from '@daisy/protocol';
import { expectRoundResult } from './round-result-proof';
import { expect, openPage } from './fixtures';
import { origin } from './accounts';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import {
  claim,
  createFromPlay,
  readyUp,
  reread,
  turnOffPreRoundPrep,
  submitCreateRoom,
} from './room-launch-flow';
import { readBallotRound } from './human-ballot-round';
import { attendanceEvidence } from './attendance-evidence';
import { subscriptionLedger } from './subscription-ledger';

type Seat = 'Affirmative 1' | 'Negative 1' | 'Judge 1';
type Player = { readonly page: Page; readonly seat: Seat };

/** Prep before the round off through Room setup; prep time during the round stays on. */
async function skipPreRoundPrep(host: Page, room: RoomView) {
  await turnOffPreRoundPrep(host);
  await expect(async () => {
    room = await reread(host.request, room.id);
    expect([room.config.preRoundPrep, room.config.inRoundPrep.enabled]).toEqual(
      [{ enabled: false }, true],
    );
  }).toPass({ timeout: 10_000 });
  return room;
}

/** Every seat taken, device-checked where it speaks and Ready, all through the Room page. */
async function assemble(players: readonly Player[], room: RoomView) {
  for (const { page, seat } of players) room = await claim(page, room, seat);
  for (const { page, seat } of players) {
    await page.goto(`/rooms/${room.id}`);
    await readyUp(page, seat === 'Judge 1' ? [] : undefined);
  }
  await expect(async () => {
    room = await reread(players[0]!.page.request, room.id);
    expect(room.capabilities.canStart).toBe(true);
  }).toPass({ timeout: 10_000 });
  return room;
}

/** The host's Launch, with the native command identity kept for a later replay. */
async function launch(host: Page) {
  const button = host.getByRole('button', { name: 'Start round', exact: true });
  await expect(button).toBeEnabled();
  const form = button.locator('..');
  const replay = {
    commandId: await form.locator('[name="commandId"]').inputValue(),
    expectedVersion: Number(
      await form.locator('[name="expectedVersion"]').inputValue(),
    ),
  };
  await button.click();
  await expect(host).toHaveURL(/\/rounds\/[a-z0-9]+\/room$/);
  return {
    roundId: new URL(host.url()).pathname.split('/').at(-2)!,
    replay,
  };
}

const readRound = async (page: Page, id: string): Promise<RoundView> =>
  readBallotRound(page.request, id);

type Debaters = Record<'affirmative' | 'negative', Page>;

/** Waits on the persisted Round until `key`'s segment is open (`ended` false) or closed. */
async function untilSegment(
  page: Page,
  roundId: string,
  key: string,
  ended: boolean,
) {
  await expect(async () => {
    const view = await readRound(page, roundId);
    const segment = view.segments.find((s) => s.rulesSegmentKey === key);
    expect(segment && segment.endedAt !== null).toBe(ended);
  }).toPass({ timeout: 30_000 });
}

/** The floor holder's own End speech control, through its confirmation. */
async function endSpeech(page: Page) {
  await page.getByRole('button', { name: 'End speech', exact: true }).click();
  await page
    .getByRole('button', { name: 'Confirm end speech', exact: true })
    .click();
}

/**
 * Every turn through the debaters' own controls: the affirmative interrupts
 * the first cross-examination and yields the floor back, the negative spends prep before
 * its constructive and refreshes mid-speech, and the affirmative reconnects
 * from a new tab before its first rebuttal. Returns the pages still open.
 */
async function playEveryTurn(
  debaters: Debaters,
  contexts: Readonly<Record<keyof Debaters, BrowserContext>>,
  roundId: string,
  watch: (page: Page, label: string) => void,
) {
  const players = { ...debaters };
  await players.affirmative
    .getByRole('button', { name: 'Start round', exact: true })
    .click();
  const { rules } = await readRound(players.affirmative, roundId);
  for (const scheduled of rules.segments) {
    let holder = players[scheduled.side];
    if (scheduled.key === 'NC') {
      await holder
        .getByRole('button', { name: 'Take prep time', exact: true })
        .click();
      await holder
        .getByRole('button', { name: 'Start negative constructive' })
        .click();
    }
    await untilSegment(holder, roundId, scheduled.key, false);
    if (scheduled.key === 'CX1') {
      // The affirmative takes the floor, then yields it back (DEC-203); the
      // negative, who holds CX1, ends it.
      const interrupter = players.affirmative;
      await interrupter
        .getByRole('button', { name: 'Interrupt', exact: true })
        .click();
      await endSpeech(interrupter);
      await expect(
        interrupter.getByRole('button', { name: 'Interrupt', exact: true }),
      ).toBeEnabled();
    }
    if (scheduled.key === 'NC') await holder.reload();
    if (scheduled.key === '1AR') {
      const fresh = await openPage(contexts.affirmative, 'ROOM-6.2 reconnect');
      watch(fresh, 'affirmative');
      await fresh.goto(`/rounds/${roundId}/room`);
      await holder.close();
      holder = players.affirmative = fresh;
    }
    await endSpeech(holder);
    await untilSegment(holder, roundId, scheduled.key, true);
  }
  return players;
}

/**
 * Whether every speech but the last is settled as attended, by the rule a
 * ballot is refused under (assertRoundAttendanceSettled): its deadline and
 * settled horizon at least the finalization buffer behind now. An unhealthy
 * availability sample legitimately postpones a deadline (ISSUE-494).
 */
async function attendanceSettled(judge: Page, roundId: string) {
  const [view, evidence] = await Promise.all([
    readBallotRound(judge.request, roundId),
    attendanceEvidence(roundId),
  ]);
  const buffer = attendanceTimingPolicy.finalizationBufferMs;
  const now = Date.parse(evidence.observedAt);
  return view.segments
    .filter((segment) => segment.type === 'speech')
    .slice(0, -1)
    .every((segment) => {
      const ruled = evidence.adjudications.find(
        (row) => row.segmentId === segment.id,
      );
      const deadline = Date.parse(ruled?.effectiveDeadline ?? '');
      return (
        ruled?.decision === 'attended' &&
        deadline <= now - buffer &&
        Date.parse(ruled.settledHorizon) >= deadline + buffer
      );
    });
}

/** The judge's own enhanced ballot after the autonomous freeze and settled attendance. */
async function judgeBallot(judge: Page, roundId: string) {
  await expect(async () => {
    const response = await judge.request.get(`/api/rounds/${roundId}/ballots`);
    expect(response.status()).toBe(200);
    expect((await response.json()).freeze).not.toBeNull();
  }).toPass({ timeout: 180_000 });
  await expect
    .poll(() => attendanceSettled(judge, roundId), { timeout: 60_000 })
    .toBe(true);
  await judge.goto(`/judge/ballot/${roundId}`);
  await judge
    .locator('label')
    .filter({ has: judge.locator('input[name="winner"][value="negative"]') })
    .click();
  await judge
    .getByLabel('Reason for decision')
    .fill('The negative carried the decisive comparison in this test Round.');
  await judge
    .getByRole('button', { name: 'Submit ballot', exact: true })
    .click();
  await expect(
    judge.getByText('Ballot submitted.', { exact: false }),
  ).toBeVisible();
}

/**
 * ROOM-6.2 as reconciled (Round delivery reconciliation): three browsers play
 * one human game to a real ballot; the started Room stays immutable; the next
 * match is a distinct Room through the create journey with fresh Ready.
 */
export async function proveThreeBrowserRound(browser: Browser) {
  const accounts = await createRoomLaunchAccounts(browser, 3);
  const ledger = subscriptionLedger();
  try {
    for (const { context } of accounts.members)
      await context.grantPermissions(['camera', 'microphone'], { origin });
    const [aff, neg, judge] = await Promise.all(
      ['affirmative host', 'negative', 'judge'].map((label, index) =>
        openPage(accounts.members[index]!.context, `ROOM-6.2 ${label}`),
      ),
    );
    for (const [page, label] of [
      [aff!, 'affirmative'],
      [neg!, 'negative'],
      [judge!, 'judge'],
    ] as const)
      ledger.watch(page, label);
    const players: Player[] = [
      { page: aff!, seat: 'Affirmative 1' },
      { page: neg!, seat: 'Negative 1' },
      { page: judge!, seat: 'Judge 1' },
    ];
    let room = await createFromPlay(
      aff!,
      `ROOM-6.2 ${createId().slice(0, 8)}`,
      'value',
    );
    room = await skipPreRoundPrep(aff!, room);
    room = await assemble(players, room);
    const first = await launch(aff!);
    // The members who did not press Start round follow the live room page's link.
    for (const page of [neg!, judge!])
      await page.getByRole('link', { name: 'View the round' }).click();
    await expect(neg!).toHaveURL(`/rounds/${first.roundId}/room`);
    await expect(judge!).toHaveURL(
      new RegExp(`/rounds/${first.roundId}(/room)?$`),
    );
    // Both debaters' first subscribe to the Round is accepted, not retried.
    await expect
      .poll(() => [ledger.refusals, ledger.subscribed])
      .toEqual([
        [],
        expect.arrayContaining(
          ['affirmative', 'negative'].map(
            (side) => `${side} debate:${first.roundId}`,
          ),
        ),
      ]);
    const played = await playEveryTurn(
      { affirmative: aff!, negative: neg! },
      {
        affirmative: accounts.members[0]!.context,
        negative: accounts.members[1]!.context,
      },
      first.roundId,
      ledger.watch,
    );
    // No subscribe was refused through the refresh and the reconnect.
    expect(ledger.refusals).toEqual([]);
    const host = played.affirmative;
    await judgeBallot(judge!, first.roundId);
    await expect(host).toHaveURL(`/rounds/${first.roundId}`, {
      timeout: 15_000,
    });
    await expect(played.negative).toHaveURL(`/rounds/${first.roundId}`);
    await judge!.goto(`/rounds/${first.roundId}`);
    await expectRoundResult(
      { debaters: [host, played.negative], judge: judge! },
      'Result · Negative won',
    );
    const finished = await readRound(host, first.roundId);
    expect([finished.status, finished.outcome]).toEqual([
      'completed',
      'negative',
    ]);
    const started = await reread(host.request, room.id);
    expect(started.roundRef?.id).toBe(first.roundId);

    await host.goto(`/rooms/${room.id}`);
    await host
      .getByRole('link', { name: 'Create a new room', exact: true })
      .click();
    await expect(host).toHaveURL(`/rooms/${room.id}/rematch`);
    let next = await submitCreateRoom(
      host,
      `ROOM-6.2 next ${createId().slice(0, 8)}`,
      'value',
    );
    expect(next.id).not.toBe(room.id);
    expect([next.participants.length, next.readiness.readyActorIds]).toEqual([
      0,
      [],
    ]);
    next = await skipPreRoundPrep(host, next);
    next = await assemble(
      [{ page: host, seat: 'Affirmative 1' }, ...players.slice(1)],
      next,
    );
    const second = await launch(host);
    expect(second.roundId).not.toBe(first.roundId);

    const replay = await host.request.post(`/api/rooms/${room.id}/commands`, {
      headers: { origin },
      data: { type: 'start-round', ...first.replay },
    });
    expect(replay.status()).toBe(200);
    expect((await replay.json()).receipt.replayed).toBe(true);
    expect(await reread(host.request, room.id)).toEqual(started);
    expect(roundViewSchema.parse(await readRound(host, first.roundId))).toEqual(
      finished,
    );
    const seats = (await readRound(host, second.roundId)).participants.filter(
      isNamedSeat,
    );
    expect(seats.map((seat) => seat.role).sort()).toEqual([
      'affirmative',
      'judge',
      'negative',
    ]);
    expect(ledger.refusals).toEqual([]);
  } finally {
    await accounts.closeContexts();
  }
}
