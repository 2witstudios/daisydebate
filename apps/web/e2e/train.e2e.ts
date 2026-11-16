import { createId } from '@paralleldrive/cuid2';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isNamedSeat, type RoomView } from '@daisy/protocol';
import type { Response } from '@playwright/test';
import { expect, test, openPage } from './support/fixtures';
import { readRoomBotRoster, startTrainPractice } from './support/ai-cast';
import { resetRateLimits, signUpMember, origin } from './support/accounts';
import {
  claim,
  createFromPlay,
  deniedCommand,
  reread,
  submitCreateRoom,
} from './support/room-launch-flow';

/** The seated participant an actor id names; anonymous judges name nobody. */
const seated = (view: RoomView, actorId: string) =>
  view.participants.find((p) => isNamedSeat(p) && p.actorId === actorId);

test('Train seats the chosen bot in a durable, editable Room', async ({
  browser,
}, info) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  try {
    await context.grantPermissions(['camera', 'microphone'], { origin });
    await resetRateLimits(context.request);
    await signUpMember(context.request);
    const page = await openPage(context, 'Train host');
    const roster = await readRoomBotRoster(page.request);
    const wren = roster.find(
      (bot) => bot.label === 'Wren' && bot.seatRole === 'debater',
    );
    expect(wren?.eligible).toBe(true);
    await page.goto('/train');
    // The real roster renders with its one Start practice act.
    await expect(
      page.getByRole('button', { name: 'Start practice' }),
    ).toBeVisible();
    const roomId = await startTrainPractice(page, wren!.actorId, 'Wren');
    let view = await reread(page.request, roomId);
    // The chosen opponent is seated in the durable cast, the AI judge judges,
    // and the Room waits for its human: assembling, never readiness.
    expect(seated(view, wren!.actorId)).toMatchObject({
      kind: 'bot',
      role: 'negative',
      slot: 0,
    });
    expect(view.participants.find((p) => p.role === 'judge')?.kind).toBe('bot');
    expect(view.status).toBe('assembling');
    // The choice survives a reload because the Room holds it.
    await page.reload();
    view = await reread(page.request, roomId);
    expect(seated(view, wren!.actorId)?.role).toBe('negative');
    const hostActorId = view.hostActorId;
    if (!hostActorId) throw new Error('Host identity was redacted to itself');
    // The host claims their own side in the ordinary Room. Train does not
    // synthesize readiness or jump past the existing Room gates.
    view = await claim(page, view, 'Affirmative 1');
    expect(seated(view, hostActorId)?.role).toBe('affirmative');
    expect(seated(view, wren!.actorId)?.role).toBe('negative');
    expect(view.status).toBe('ready');
    await page.reload();
    view = await reread(page.request, roomId);
    expect(seated(view, wren!.actorId)?.role).toBe('negative');
    expect(seated(view, hostActorId)?.role).toBe('affirmative');
    await info.attach('train-room-evidence', {
      body: JSON.stringify({ candidate: process.env.GIT_COMMIT, roomId }),
      contentType: 'application/json',
    });
  } finally {
    await context.close();
  }
});

test('native Train Start practice creates a Room and recovers an active Room with a 303', async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    javaScriptEnabled: false,
  });
  try {
    await resetRateLimits(context.request);
    await signUpMember(context.request);
    const page = await openPage(context, 'Native Train host');
    const roster = await readRoomBotRoster(page.request);
    const opponent = roster.find(
      (bot) => bot.label === 'Wren' && bot.seatRole === 'debater',
    );
    expect(opponent?.eligible).toBe(true);
    const nativePosts: Response[] = [];
    page.on('response', (response) => {
      if (
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/train'
      )
        nativePosts.push(response);
    });

    await page.goto(`/train?bot=${opponent!.actorId}`);
    await page.getByRole('button', { name: 'Start practice' }).click();
    await expect(page).toHaveURL(/\/rooms\/[a-z0-9]{24}$/);
    const roomId = new URL(page.url()).pathname.split('/').at(-1)!;
    expect(nativePosts[0]?.status()).toBe(303);
    expect(new URL(nativePosts[0]!.headers().location!, origin).pathname).toBe(
      `/rooms/${roomId}`,
    );
    const created = await reread(page.request, roomId);
    expect(seated(created, opponent!.actorId)).toMatchObject({
      role: 'negative',
      kind: 'bot',
    });

    // A native retry cannot create a second active Room; its 303 returns to
    // the exact Room that still owns this member.
    await page.goto(`/train?bot=${opponent!.actorId}`);
    await page.getByRole('button', { name: 'Start practice' }).click();
    await expect(page).toHaveURL(`/rooms/${roomId}`);
    expect(nativePosts[1]?.status()).toBe(303);
    expect(new URL(nativePosts[1]!.headers().location!, origin).pathname).toBe(
      `/rooms/${roomId}`,
    );
    expect((await reread(page.request, roomId)).id).toBe(roomId);
  } finally {
    await context.close();
  }
});

for (const javaScriptEnabled of [true, false]) {
  test(`an ordinary host fills side and judge seats from the roster (${javaScriptEnabled ? 'enhanced' : 'native'}), and refusals leave the cast unchanged`, async ({
    browser,
  }, info) => {
    test.setTimeout(120_000);
    const hostContext = await browser.newContext({
      javaScriptEnabled,
      baseURL: origin,
      ignoreHTTPSErrors: true,
    });
    const outsiderContext = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
    });
    try {
      await resetRateLimits(hostContext.request);
      const { username: hostName } = await signUpMember(hostContext.request);
      await signUpMember(outsiderContext.request);
      const host = await openPage(hostContext, 'Manage host');
      const outsider = await openPage(outsiderContext, 'Manage outsider');
      const roster = await readRoomBotRoster(host.request);
      // The roster's Seat picker offers eligible bots only.
      const debater = roster.find(
        (bot) => bot.seatRole === 'debater' && bot.eligible,
      );
      const judge = roster.find(
        (bot) => bot.seatRole === 'judge' && bot.eligible,
      );
      let view = await createFromPlay(
        host,
        `Manage bots ${createId().slice(0, 8)}`,
        'freestyle',
      );
      // Each open seat's row carries the host's own Seat picker.
      const picker = (seat: string) =>
        host.getByLabel(`Seat someone in ${seat}`, { exact: true });
      const row = (name: string) =>
        host.getByRole('listitem', { name, exact: true });
      await expect(picker('Negative 1')).toHaveValue('');
      const seatBot = async (seat: string, actorId: string, label: string) => {
        const select = picker(seat);
        const form = host.locator('form').filter({ has: select });
        await select.selectOption(actorId);
        await form.getByRole('button', { name: 'Seat', exact: true }).click();
        await expect(async () => {
          view = await reread(host.request, view.id);
          expect(seated(view, actorId) !== undefined).toBe(true);
        }).toPass({ timeout: 10_000 });
        // The seat's row now names its occupant, and its picker is gone.
        await expect(row(label)).toBeVisible();
        await expect(select).toHaveCount(0);
      };
      /** The host's Remove on an occupied row: the seat opens again. */
      const removeFrom = async (seat: string, label: string) => {
        await row(label)
          .getByRole('button', { name: `Remove ${label}`, exact: true })
          .click();
        await expect(row(seat)).toBeVisible();
        await expect(async () => {
          view = await reread(host.request, view.id);
          expect(
            view.participants.some(
              (p) => isNamedSeat(p) && p.role === 'negative',
            ),
          ).toBe(false);
        }).toPass({ timeout: 10_000 });
      };
      await seatBot('Negative 1', debater!.actorId, debater!.label);
      await seatBot('Judge 1', judge!.actorId, judge!.label);
      const hostId = view.hostActorId;
      if (!hostId) throw new Error('Host identity was redacted to itself');
      await seatBot('Affirmative 1', hostId, hostName);
      // An occupied seat is never assigned over: the host removes its
      // occupant first, then seats a second bot, and back the same way.
      const understudy = roster.find(
        (bot) =>
          bot.seatRole === 'debater' &&
          bot.eligible &&
          bot.actorId !== debater!.actorId,
      );
      await removeFrom('Negative 1', debater!.label);
      await seatBot('Negative 1', understudy!.actorId, understudy!.label);
      view = await reread(host.request, view.id);
      expect(seated(view, understudy!.actorId)).toMatchObject({
        role: 'negative',
        slot: 0,
      });
      expect(seated(view, debater!.actorId)).toBeUndefined();
      expect(seated(view, hostId)?.role).toBe('affirmative');
      await removeFrom('Negative 1', understudy!.label);
      await seatBot('Negative 1', debater!.actorId, debater!.label);
      view = await reread(host.request, view.id);
      expect(seated(view, understudy!.actorId)).toBeUndefined();
      expect(seated(view, debater!.actorId)?.role).toBe('negative');
      // The cast is durable: a reload still shows both bots seated.
      await host.reload();
      await expect(row(debater!.label)).toBeVisible();
      await expect(row(judge!.label)).toBeVisible();
      await expect(row(hostName)).toBeVisible();
      await expect(picker('Negative 1')).toHaveCount(0);
      view = await reread(host.request, view.id);
      expect(seated(view, debater!.actorId)).toMatchObject({
        role: 'negative',
        slot: 0,
      });
      expect(seated(view, judge!.actorId)).toMatchObject({
        role: 'judge',
        slot: 0,
      });
      const castOf = (v: RoomView) =>
        v.participants
          .filter(isNamedSeat)
          .map((p) => [p.actorId, p.role, p.slot])
          .sort();
      const managed = await reread(host.request, view.id);
      // A nonhost commands nothing here.
      const nonhost = await deniedCommand(outsider.request, view, {
        type: 'assign-seat',
        actorId: debater!.actorId,
        role: 'affirmative',
        slot: 0,
      });
      expect(nonhost.status()).toBe(403);
      // A bot debater never judges (ISSUE-750).
      const wrongRole = await deniedCommand(host.request, view, {
        type: 'assign-seat',
        actorId: debater!.actorId,
        role: 'judge',
        slot: 0,
      });
      expect(wrongRole.status()).toBe(409);
      expect(((await wrongRole.json()) as { refusal: string }).refusal).toBe(
        'actor-ineligible',
      );
      expect(castOf(await reread(host.request, view.id))).toEqual(
        castOf(managed),
      );
      // Ranked play admits no bot debater; the refusal is visible and the cast
      // stays exactly as the host left it.
      await new Promise<void>((resolve, reject) =>
        execFile(
          'bun',
          [
            fileURLToPath(
              new URL('./support/rating-season-worker.ts', import.meta.url),
            ),
          ],
          { timeout: 20_000 },
          (error) =>
            error ? reject(new Error('Season setup refused')) : resolve(),
        ),
      );
      await host.request.post(`/api/rooms/${view.id}/commands`, {
        headers: { origin },
        data: {
          type: 'close',
          commandId: createId(),
          expectedVersion: view.version,
        },
      });
      await host.goto('/play/room');
      const rankedView = await submitCreateRoom(
        host,
        `Ranked bots ${createId().slice(0, 8)}`,
        'freestyle',
        true,
      );
      const rankedCast = await host.request.post(
        `/api/rooms/${rankedView.id}/commands`,
        {
          headers: { origin },
          data: {
            type: 'assign-seat',
            commandId: createId(),
            expectedVersion: rankedView.version,
            actorId: debater!.actorId,
            role: 'affirmative',
            slot: 0,
          },
        },
      );
      expect(rankedCast.status()).toBe(409);
      expect(((await rankedCast.json()) as { refusal: string }).refusal).toBe(
        'actor-ineligible',
      );
      const after = await reread(host.request, rankedView.id);
      // The refusal leaves the ranked cast exactly as it was: empty.
      expect(after.participants).toHaveLength(0);
      await info.attach('manage-seats-evidence', {
        body: JSON.stringify({
          candidate: process.env.GIT_COMMIT,
          roomId: view.id,
          rankedId: rankedView.id,
        }),
        contentType: 'application/json',
      });
    } finally {
      await hostContext.close();
      await outsiderContext.close();
    }
  });
}
