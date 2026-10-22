import type { Browser, Page } from '@playwright/test';
import { createId } from '@paralleldrive/cuid2';
import {
  isNamedSeat,
  roundViewSchema,
  type RoomView,
  type RoundView,
} from '@daisy/protocol';
import { expect, openPage } from './fixtures';
import { origin } from './accounts';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import {
  claim,
  createFromPlay,
  reread,
  submitCreateRoom,
} from './room-launch-flow';
import { readBallotRound } from './human-ballot-round';

type Seat = 'Affirmative 1' | 'Negative 1' | 'Judge 1';
type Player = { readonly page: Page; readonly seat: Seat };

/** Both preparation phases off through the Room settings form, so every turn ends on its holder's command. */
async function disablePreparation(host: Page, room: RoomView) {
  await host.getByText('Edit settings', { exact: true }).click();
  const settings = host.getByRole('form', { name: 'Room settings' });
  await settings.getByLabel('Enable preparation before Launch').uncheck();
  await settings.getByLabel('Enable preparation during the Round').uncheck();
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await expect(async () => {
    room = await reread(host.request, room.id);
    expect([room.config.preRoundPrep, room.config.inRoundPrep]).toEqual([
      { enabled: false },
      { enabled: false },
    ]);
  }).toPass({ timeout: 10_000 });
  return room;
}

/** Every seat taken, device-checked where it speaks and Ready, all through the Room page. */
async function assemble(players: readonly Player[], room: RoomView) {
  for (const { page, seat } of players) room = await claim(page, room, seat);
  for (const { page, seat } of players) {
    await page.goto(`/rooms/${room.id}`);
    if (seat !== 'Judge 1')
      for (const device of ['camera', 'microphone'])
        await page
          .getByRole('button', { name: `Check ${device}`, exact: true })
          .click();
    await page.getByRole('button', { name: 'I am ready', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Not ready', exact: true }),
    ).toBeVisible();
  }
  await expect(async () => {
    room = await reread(players[0]!.page.request, room.id);
    expect(room.capabilities.canStart).toBe(true);
  }).toPass({ timeout: 10_000 });
  return room;
}

/** The host's Launch, with the native command identity kept for a later replay. */
async function launch(host: Page) {
  const button = host.getByRole('button', { name: 'Launch', exact: true });
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

/** Each open turn is ended by its own floor holder's End speech control. */
async function playEveryTurn(
  debaters: Readonly<Record<'affirmative' | 'negative', Page>>,
  roundId: string,
) {
  const host = debaters.affirmative;
  await host.getByRole('button', { name: 'Start round', exact: true }).click();
  let view = await readRound(host, roundId);
  for (const scheduled of view.rules.segments) {
    await expect(async () => {
      view = await readRound(host, roundId);
      expect(
        view.segments.find((s) => s.endedAt === null)?.rulesSegmentKey,
      ).toBe(scheduled.key);
    }).toPass({ timeout: 30_000 });
    const page = debaters[scheduled.side];
    await page.getByRole('button', { name: 'End speech', exact: true }).click();
    await page
      .getByRole('button', { name: 'Confirm end speech', exact: true })
      .click();
    await expect(async () => {
      view = await readRound(host, roundId);
      expect(
        view.segments.find((s) => s.rulesSegmentKey === scheduled.key)?.endedAt,
      ).not.toBeNull();
    }).toPass({ timeout: 15_000 });
  }
  return view;
}

/** The judge's own enhanced ballot after the autonomous freeze. */
async function judgeBallot(judge: Page, roundId: string) {
  await expect(async () => {
    const response = await judge.request.get(`/api/rounds/${roundId}/ballots`);
    expect(response.status()).toBe(200);
    expect((await response.json()).freeze).not.toBeNull();
  }).toPass({ timeout: 180_000 });
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
  try {
    for (const { context } of accounts.members)
      await context.grantPermissions(['camera', 'microphone'], { origin });
    const [aff, neg, judge] = await Promise.all(
      ['affirmative host', 'negative', 'judge'].map((label, index) =>
        openPage(accounts.members[index]!.context, `ROOM-6.2 ${label}`),
      ),
    );
    const players: Player[] = [
      { page: aff!, seat: 'Affirmative 1' },
      { page: neg!, seat: 'Negative 1' },
      { page: judge!, seat: 'Judge 1' },
    ];
    let room = await createFromPlay(
      aff!,
      `ROOM-6.2 ${createId().slice(0, 8)}`,
      'one-on-one',
    );
    room = await disablePreparation(aff!, room);
    room = await assemble(players, room);
    const first = await launch(aff!);
    await expect(neg!).toHaveURL(`/rounds/${first.roundId}/room`, {
      timeout: 15_000,
    });
    await expect(judge!).toHaveURL(
      new RegExp(`/rounds/${first.roundId}(/room)?$`),
      { timeout: 15_000 },
    );
    await playEveryTurn({ affirmative: aff!, negative: neg! }, first.roundId);
    await judgeBallot(judge!, first.roundId);
    await expect(aff!).toHaveURL(`/rounds/${first.roundId}`, {
      timeout: 15_000,
    });
    await expect(
      aff!.getByText('Result · Negative won', { exact: true }),
    ).toBeVisible();
    const finished = await readRound(aff!, first.roundId);
    expect([finished.status, finished.outcome]).toEqual([
      'completed',
      'negative',
    ]);
    const started = await reread(aff!.request, room.id);
    expect(started.roundRef?.id).toBe(first.roundId);

    await aff!.goto(`/rooms/${room.id}`);
    await aff!
      .getByRole('link', { name: 'Create a fresh Room', exact: true })
      .click();
    await expect(aff!).toHaveURL(`/rooms/${room.id}/rematch`);
    let next = await submitCreateRoom(
      aff!,
      `ROOM-6.2 next ${createId().slice(0, 8)}`,
      'one-on-one',
    );
    expect(next.id).not.toBe(room.id);
    expect([next.participants.length, next.readiness.readyActorIds]).toEqual([
      0,
      [],
    ]);
    next = await disablePreparation(aff!, next);
    next = await assemble(players, next);
    const second = await launch(aff!);
    expect(second.roundId).not.toBe(first.roundId);

    const replay = await aff!.request.post(`/api/rooms/${room.id}/commands`, {
      headers: { origin },
      data: { type: 'start-round', ...first.replay },
    });
    expect(replay.status()).toBe(200);
    expect((await replay.json()).receipt.replayed).toBe(true);
    expect(await reread(aff!.request, room.id)).toEqual(started);
    expect(roundViewSchema.parse(await readRound(aff!, first.roundId))).toEqual(
      finished,
    );
    const seats = (await readRound(aff!, second.roundId)).participants.filter(
      isNamedSeat,
    );
    expect(seats.map((seat) => seat.role).sort()).toEqual([
      'affirmative',
      'judge',
      'negative',
    ]);
  } finally {
    await accounts.closeContexts();
  }
}
