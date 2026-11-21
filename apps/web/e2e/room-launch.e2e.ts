import { enterLobbyRoom, proveGathering } from './support/room-gathering-proof';
import { proveLobbyDiscovery } from './support/room-lobby-discovery';
import { proveFormatPicker } from './support/room-launch-format';
import { proveFormatChoice } from './support/room-format-choice';
import { proveHumanLaunch } from './support/room-launch-human';
import { proveCoinFlip } from './support/room-coin-flip';
import { createId } from '@paralleldrive/cuid2';
import {
  affirmativeSide,
  isJudgeSeat,
  isNamedSeat,
  judgeSeat,
  negativeSide,
  roomViewSchema,
  roundViewSchema,
  sideOfSeat,
  sideSeat,
  type RoomView,
} from '@daisy/protocol';
import { expect, test, openPage } from './support/fixtures';
import { origin } from './support/accounts';
import {
  reread,
  deniedCommand,
  createFromPlay,
  setResolution,
  claim,
  prepareJudgeRoom,
  assertFrozenLaunch,
  readyUp,
  turnOffPreRoundPrep,
  clockText,
  openRoomSetup,
  saveRoundSettings,
} from './support/room-launch-flow';
import { launchCustomSelection } from './support/room-launch-custom';
import { proveLoopbackUpstreams } from './support/launch-loopback';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { launchEvidence } from './support/room-launch-evidence';
import { hydrated } from './support/hydration';
import { readyOwnSeat } from './support/human-ballot-round';
import { readRoomBotRoster, startTrainPractice } from './support/ai-cast';
import {
  closeSettledLaunchContexts,
  settledLaunchAuth,
} from './support/room-launch-settled';

const seated = (view: import('@daisy/protocol').RoomView, actorId: string) =>
  view.participants.find(
    (participant) =>
      isNamedSeat(participant) && participant.actorId === actorId,
  );
// Actors, receipt and competitive history deliberately survive context closure.
// Only a released suite-owned slot lifecycle can destroy this proof data.
test('canonical browser create, settings, cast, refusals and reread preserve durable authority', async ({
  browser,
}, info) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const host = await openPage(accounts.members[0]!.context, 'Launch host');
    const guest = await openPage(accounts.members[1]!.context, 'Launch guest');
    let view = await createFromPlay(
      host,
      `Launch proof ${createId().slice(0, 8)}`,
      'freestyle',
      setResolution,
    );
    expect(view.formatVersion).toBeGreaterThan(0);
    expect(view.rules.segments.length).toBeGreaterThan(1);
    await guest.goto('/lobby');
    await guest.getByLabel('Search rooms').fill(view.title);
    await guest.getByRole('button', { name: 'Apply', exact: true }).click();
    await enterLobbyRoom(guest, view, 'Join');
    view = await claim(guest, view, 'Negative 1');
    await expect(guest.getByRole('button', { name: 'Save room' })).toHaveCount(
      0,
    );
    await expect(
      guest.getByRole('button', { name: 'Save round settings' }),
    ).toHaveCount(0);
    await settledLaunchAuth();
    const before = await launchEvidence(view.id);
    const denied = await deniedCommand(guest.request, view, {
      type: 'update-details',
      title: 'Forbidden',
      topic: view.topic,
      visibility: view.visibility,
    });
    expect(denied.status()).toBe(403);
    const stale = await deniedCommand(
      host.request,
      { ...view, version: view.version - 1 },
      { type: 'close' },
    );
    expect(stale.status()).toBe(409);
    expect((await launchEvidence(view.id)).hash).toBe(before.hash);
    await host.goto(`/rooms/${view.id}`);
    await openRoomSetup(host);
    const details = host.getByRole('form', { name: 'Room details' });
    await details
      .getByLabel('Room name', { exact: true })
      .fill('Stored Launch proof');
    await details.getByRole('button', { name: 'Save room' }).click();
    await expect(
      host.getByText('Stored Launch proof', { exact: true }),
    ).toBeVisible();
    view = await reread(host.request, view.id);
    const settings = await openRoomSetup(host, true);
    const first = view.rules.segments[0]!;
    const second = view.rules.segments[1]!;
    // A Custom room advertises 1 s minimums, but a speech must still cover
    // the attendance grace, so the proof starts from a minute in bounds.
    const firstBounds =
      view.definition.configurable.timing.segmentDurationMs[first.key]!;
    const firstMs = Math.max(
      firstBounds.min,
      Math.min(firstBounds.max, 60_000),
    );
    const secondBounds =
      view.definition.configurable.timing.segmentDurationMs[second.key]!;
    const secondMs = Math.max(
      secondBounds.min,
      Math.min(secondBounds.max, firstMs + 1000),
    );
    expect(firstMs).not.toBe(secondMs);
    await settings
      .locator(`[name="duration.segment.${first.key}"]`)
      .fill(clockText(firstMs));
    await settings
      .locator(`[name="duration.segment.${second.key}"]`)
      .fill(clockText(secondMs));
    await saveRoundSettings(host);
    await expect(async () => {
      view = await reread(host.request, view.id);
      expect(view.rules.segments.slice(0, 2).map((s) => s.durationMs)).toEqual([
        firstMs,
        secondMs,
      ]);
    }).toPass();
    view = await claim(host, view, 'Affirmative 1');
    await guest.reload();
    expect(await reread(guest.request, view.id)).toMatchObject({
      title: view.title,
      config: view.config,
      version: view.version,
    });
    await info.attach('retained-competitive-evidence', {
      body: JSON.stringify({
        candidate: process.env.GIT_COMMIT,
        ...(await launchEvidence(view.id)),
      }),
      contentType: 'application/json',
    });
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('judge Ready and eligible stored bot debaters start one frozen Round', async ({
  browser,
}, info) => {
  const accounts = await createRoomLaunchAccounts(browser, 1);
  try {
    const context = accounts.members[0]!.context;
    const page = await openPage(context, 'bot Launch host');
    let view = await prepareJudgeRoom(
      page,
      `Bot proof ${createId().slice(0, 8)}`,
    );
    // The judge's own Ready through the Room page; no readiness injection.
    const judge = page;
    await judge.goto(`/rooms/${view.id}`);
    await readyUp(judge, false);
    view = await reread(judge.request, view.id);
    expect(view.participants.find((p) => isJudgeSeat(p.seat))!.ready).toBe(
      'ready',
    );
    expect(view.capabilities.canStart).toBe(true);
    const launchForm = judge
      .getByRole('button', { name: 'Start round', exact: true })
      .locator('..');
    const commandId = await launchForm
      .locator('[name="commandId"]')
      .inputValue();
    const expectedVersion = Number(
      await launchForm.locator('[name="expectedVersion"]').inputValue(),
    );
    await judge
      .getByRole('button', { name: 'Start round', exact: true })
      .click();
    await expect(judge).toHaveURL(/\/rounds\/[a-z0-9]+(\/room)?$/);
    const launched = await reread(judge.request, view.id);
    expect(launched.roundRef).not.toBeNull();
    const receipt = await judge.request.get(
      `/api/rounds/${launched.roundRef!.id}`,
    );
    expect(receipt.status()).toBe(200);
    const round = roundViewSchema.parse(await receipt.json());
    expect(round).toMatchObject({
      status: 'active',
      startedAt: expect.any(String),
      topic: view.topic,
      config: view.config,
    });
    const proof = await assertFrozenLaunch(view);
    const retry = await judge.request.post(`/api/rooms/${view.id}/commands`, {
      headers: { origin },
      data: { type: 'start-round', commandId, expectedVersion },
    });
    expect(retry.status()).toBe(200);
    expect((await retry.json()).receipt.replayed).toBe(true);
    expect((await launchEvidence(view.id)).hash).toBe(proof.hash);
    await judge.goto(`/rounds/${round.id}`);
    await expect(
      judge.getByText('Round · In progress', { exact: true }),
    ).toBeVisible();
    // Leave explicitly so the Lobby stays open instead of auto-resuming the judge.
    await judge.goto(`/rounds/${round.id}/room`);
    const backToLobby = judge.getByRole('link', {
      name: 'Back to the lobby',
      exact: true,
    });
    await hydrated(backToLobby);
    await backToLobby.click();
    await expect(judge).toHaveURL(/\/lobby$/);
    await judge.goto(`/lobby?${new URLSearchParams({ q: view.title })}`);
    // The judge holds a seat, so the row leads back into the round room.
    await expect(
      judge.getByRole('link', { name: /^Return to room: / }),
    ).toHaveAttribute('href', `/rounds/${round.id}/room`);
    await info.attach('started-round-evidence', {
      body: JSON.stringify(proof),
      contentType: 'application/json',
    });
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('Train carries its chosen bot through the durable Room into one shared Round', async ({
  browser,
}, info) => {
  test.setTimeout(240_000);
  const accounts = await createRoomLaunchAccounts(browser, 1);
  try {
    const member = accounts.members[0]!;
    const context = member.context;
    const page = await openPage(context, 'Train scheduled-round host');
    const bots = await readRoomBotRoster(page.request);
    const opponent = bots.find(
      (bot) => bot.label === 'Wren' && bot.aiRole === 'debater',
    );
    expect(opponent?.eligible).toBe(true);
    const roomId = await startTrainPractice(page, opponent!.actorId, 'Wren');
    let view = await reread(page.request, roomId);
    expect(seated(view, opponent!.actorId)).toMatchObject({
      kind: 'bot',
      seat: sideSeat(negativeSide),
    });
    expect(
      seated(view, bots.find((bot) => bot.aiRole === 'judge')!.actorId),
    ).toMatchObject({ seat: judgeSeat(), kind: 'bot' });
    expect(view.status).toBe('assembling');

    await page.reload();
    view = await reread(page.request, roomId);
    expect(seated(view, opponent!.actorId)?.seat).toEqual(
      sideSeat(negativeSide),
    );
    expect(view.status).toBe('assembling');
    await turnOffPreRoundPrep(page);
    view = await reread(page.request, roomId);
    view = await claim(page, view, 'Affirmative 1');

    // The human host explicitly Readies through the normal Room command;
    // Train itself mints no consent.
    view = await readyOwnSeat(member, view, sideSeat(affirmativeSide));
    const readyAtReceipt = [...view.readiness.readyActorIds];
    const startRound = await page.request.post(
      `/api/rooms/${roomId}/commands`,
      {
        headers: { origin },
        data: {
          type: 'start-round',
          commandId: createId(),
          expectedVersion: view.version,
        },
      },
    );
    const startReceipt = (await startRound.json()) as {
      refusal?: string;
      view?: RoomView;
    };
    if (startRound.status() !== 200) {
      const current = await reread(page.request, roomId);
      await info.attach('train-readiness-loss', {
        body: JSON.stringify({
          candidate: process.env.GIT_COMMIT,
          roomId,
          status: startRound.status(),
          refusal: startReceipt.refusal,
          readyAtReceipt,
          readyAtStart: current.readiness.readyActorIds,
          roomVersion: current.version,
        }),
        contentType: 'application/json',
      });
      throw new Error(
        `Train Round start refused after explicit Ready: ${startReceipt.refusal ?? startRound.status()}`,
      );
    }
    view = roomViewSchema.parse(startReceipt.view);
    expect(view.roundRef).toMatchObject({ status: 'opening' });
    const roundId = view.roundRef!.id;
    const readRoundView = async () => {
      const response = await page.request.get(`/api/rounds/${roundId}`);
      expect(response.status()).toBe(200);
      return roundViewSchema.parse(await response.json());
    };
    // The bot's automatic strike may race this read: drive only the
    // authority-checked strike command, reading the draw before each one.
    for (let strike = 0; strike < 3; strike++) {
      let round = await readRoundView();
      await expect(async () => {
        round = await readRoundView();
        expect(round.topic !== null || round.opening?.canStrike === true).toBe(
          true,
        );
      }).toPass({ timeout: 30_000 });
      if (round.topic !== null) break;
      const draw = round.opening?.draw;
      if (draw?.visibility !== 'debater' || !draw.turn)
        throw new Error('Train host cannot read the active draw');
      const struck = new Set(draw.strikes.map((item) => item.position));
      const position = draw.items.find(
        (item) => !struck.has(item.position),
      )?.position;
      if (position === undefined)
        throw new Error('Train draw has no available host strike');
      const response = await page.request.post(
        `/api/rounds/${roundId}/commands`,
        {
          headers: { origin },
          data: {
            version: 1,
            commandId: createId(),
            expectedVersion: round.version,
            command: {
              type: 'strike_resolution',
              // Practice flips for sides (ADR 0145): the host strikes as
              // whichever side its seat drew.
              participantId: round.participants
                .filter(isNamedSeat)
                .find((p) => p.actorId === view.hostActorId)!.id,
              ordinal: draw.turn.ordinal,
              position,
            },
          },
        },
      );
      expect(response.status()).toBe(200);
    }
    // With prep off, the last strike started the Round.
    await expect(async () => {
      const round = await readRoundView();
      expect(round.topic).not.toBeNull();
      expect(round.status).toBe('active');
    }).toPass({ timeout: 30_000 });
    // The coin decided the sides: host and bot argue opposite ones.
    const sides = [view.hostActorId!, opponent!.actorId].map((actorId) => {
      const seat = seated(view, actorId)?.seat;
      return seat ? sideOfSeat(seat) : null;
    });
    expect([...sides].sort()).toEqual([affirmativeSide, negativeSide]);

    // The member still holds this Room. A repeated Train create returns to
    // the same Round rather than opening another Room (ADR 0070).
    await page.goto(`/train?bot=${opponent!.actorId}`);
    await page.getByRole('button', { name: 'Start practice' }).click();
    await expect(page).toHaveURL(new RegExp(`/rounds/${roundId}(?:/room)?$`));
    await info.attach('train-started-round-evidence', {
      body: JSON.stringify({
        candidate: process.env.GIT_COMMIT,
        roomId,
        roundId,
        opponentActorId: opponent!.actorId,
      }),
      contentType: 'application/json',
    });
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('a Ready made in one tab survives a mounted tab and a reload that never checked devices', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const accounts = await createRoomLaunchAccounts(browser, 1);
  try {
    const { context } = accounts.members[0]!;
    await context.grantPermissions(['camera', 'microphone'], { origin });
    const readyTab = await openPage(context, 'Checked Ready tab');
    const uncheckedTab = await openPage(context, 'Unchecked tab');
    const opponent = (await readRoomBotRoster(readyTab.request)).find(
      (bot) => bot.label === 'Wren' && bot.aiRole === 'debater',
    );
    const roomId = await startTrainPractice(
      readyTab,
      opponent!.actorId,
      'Wren',
    );
    await claim(
      readyTab,
      await reread(readyTab.request, roomId),
      'Affirmative 1',
    );
    await uncheckedTab.goto(`/rooms/${roomId}`);
    // The controller is mounted once its Turn on button replaces the SSR notice.
    const checkControl = uncheckedTab.getByRole('button', {
      name: 'Turn on camera and mic',
      exact: true,
    });
    await expect(checkControl).toBeVisible();
    const consentSent = (page: typeof readyTab) => {
      const sent: string[] = [];
      page.on('request', (request) => {
        const value = /\r?\n\r?\n(ready|unready)\r?\n/.exec(
          (request.headers()['next-action'] && request.postData()) || '',
        )?.[1];
        if (value) sent.push(value);
      });
      return sent;
    };
    const fromChecked = consentSent(readyTab);
    const fromUnchecked = consentSent(uncheckedTab);

    await readyUp(readyTab);
    // The mounted tab reads the Ready through its own Room sync and keeps it.
    const standingReady = uncheckedTab
      .getByRole('listitem', {
        name: accounts.members[0]!.username,
        exact: true,
      })
      .getByRole('img', { name: 'Ready', exact: true });
    await expect(standingReady).toBeVisible();
    // Read only now: the checked tab's control moves before the Ready commits.
    const ready = await reread(readyTab.request, roomId);
    const ownActorId = ready.hostActorId!;
    const standing = seated(ready, ownActorId);
    // A reload mounts a new controller over the standing Ready.
    await uncheckedTab.reload();
    await expect(checkControl).toBeVisible();
    await expect(standingReady).toBeVisible();
    // The new mount's Room sync effects have run by the next frame.
    await uncheckedTab.evaluate(
      () =>
        new Promise((settled) =>
          requestAnimationFrame(() => setTimeout(settled)),
        ),
    );

    const after = await reread(readyTab.request, roomId);
    // The checked tab's own Ready shows the detector reads these commands.
    expect(fromChecked).toEqual(['ready']);
    expect(fromUnchecked).toEqual([]);
    expect(after.readiness.readyActorIds).toEqual([ownActorId]);
    expect(seated(after, ownActorId)).toEqual(standing);
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('canonical browser custom-create preserves declared unequal seats and ordered per-segment durations', async ({
  browser,
}, info) => {
  const accounts = await createRoomLaunchAccounts(browser, 1);
  try {
    const context = accounts.members[0]!.context;
    const page = await openPage(context, 'custom format host');
    const created = await context.request.post('/api/rooms', {
      headers: { origin },
      data: {
        commandId: createId(),
        title: 'Custom sequence proof',
        resolution: {
          kind: 'custom',
          text: `Proof transit motion with ${'longlabel'.repeat(10)}`,
        },
        visibility: 'public',
        selection: launchCustomSelection,
      },
    });
    expect(created.status()).toBe(201);
    let view = roomViewSchema.parse((await created.json()).view);
    expect(view.definition).toEqual(launchCustomSelection.definition);
    expect(
      view.rules.segments.map((segment) => [
        segment.key,
        segment.speak,
        segment.durationMs,
      ]),
    ).toEqual([
      ['N1', { rights: 'one', seat: sideSeat(negativeSide) }, 41000],
      ['A2', { rights: 'one', seat: sideSeat(affirmativeSide, 1) }, 53000],
      ['A1', { rights: 'one', seat: sideSeat(affirmativeSide) }, 47000],
    ]);
    await page.goto(`/rooms/${view.id}`);
    await expect(
      page.getByLabel('Seat someone in Affirmative 2', { exact: true }),
    ).toBeAttached();
    const settings = await openRoomSetup(page, true);
    await settings.locator('[name="duration.segment.A2"]').fill('0:59');
    await saveRoundSettings(page);
    await expect(async () => {
      view = await reread(context.request, view.id);
      expect(view.rules.segments.map((segment) => segment.durationMs)).toEqual([
        41000, 59000, 47000,
      ]);
    }).toPass();
    await page.reload();
    await openRoomSetup(page, true);
    await expect(settings.locator('[name="duration.segment.A2"]')).toHaveValue(
      '0:59',
    );
    view = await claim(page, view, 'Affirmative 2');
    await proveGathering(browser, context, page, view, info);
    await settledLaunchAuth();
    await info.attach('custom-sequence-evidence', {
      body: JSON.stringify(await launchEvidence(view.id)),
      contentType: 'application/json',
    });
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('human Ready and withdrawal gate Launch; both clients automatically enter the synchronized Round', async ({
  browser,
}, info) => {
  await proveHumanLaunch(browser, info);
});

test('two debaters on open sides Ready, Start round flips the coin, and both openings name opposite sides alike', async ({
  browser,
}) => {
  await proveCoinFlip(browser);
});

test('Custom library previews real speech defaults and commits the selected template', async ({
  browser,
}) => {
  await proveFormatPicker(browser);
});

test('Edit settings chooses a standard, reads Custom after an edit and goes Back', async ({
  browser,
}) => {
  await proveFormatChoice(browser);
});

test('Lobby search and keyset pages discover beyond the first page without truncation', async ({
  browser,
}) => {
  await proveLobbyDiscovery(browser);
});

test('the plaintext web, realtime and peer upstreams refuse every address but loopback', async () => {
  await proveLoopbackUpstreams();
});
