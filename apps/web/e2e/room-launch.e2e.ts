import { enterLobbyRoom, proveGathering } from './support/room-gathering-proof';
import { proveLobbyDiscovery } from './support/room-lobby-discovery';
import { proveFormatPicker } from './support/room-launch-format';
import { proveNoScriptFormatChoice } from './support/room-format-no-script';
import { proveHumanLaunch } from './support/room-launch-human';
import { createId } from '@paralleldrive/cuid2';
import {
  isNamedSeat,
  roomViewSchema,
  roundViewSchema,
  type RoomView,
} from '@daisy/protocol';
import { expect, test, openPage } from './support/fixtures';
import { origin } from './support/accounts';
import {
  reread,
  deniedCommand,
  createFromPlay,
  claim,
  prepareJudgeRoom,
  assertFrozenLaunch,
  turnOffPreRoundPrep,
  clockText,
  openRoomSetup,
  saveRoundSettings,
} from './support/room-launch-flow';
import { launchCustomSelection } from './support/room-launch-custom';
import { proveLoopbackUpstreams } from './support/launch-loopback';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { launchEvidence } from './support/room-launch-evidence';
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
    );
    expect(view.formatVersion).toBeGreaterThan(0);
    expect(view.rules.segments.length).toBeGreaterThan(1);
    await guest.goto('/lobby');
    await guest.getByLabel('Search rooms').fill(view.title);
    await guest.getByRole('button', { name: 'Apply', exact: true }).click();
    await enterLobbyRoom(guest, view);
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
    const firstMs =
      view.definition.configurable.timing.segmentDurationMs[first.key]!.min;
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

test('native judge Ready and eligible stored bot debaters launch one frozen scheduled Round', async ({
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
    // Real same-account cookies in a JS-disabled context; no readiness injection.
    const native = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      javaScriptEnabled: false,
      storageState: await context.storageState(),
    });
    try {
      const judge = await openPage(native, 'native judge Ready');
      await judge.goto(`/rooms/${view.id}`);
      await expect(
        judge.getByRole('button', { name: 'I’m ready', exact: true }),
      ).toBeEnabled();
      await judge
        .getByRole('button', { name: 'I’m ready', exact: true })
        .click();
      view = await reread(native.request, view.id);
      expect(view.participants.find((p) => p.role === 'judge')!.ready).toBe(
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
      await expect(judge).toHaveURL(/\/rounds\/[a-z0-9]+$/);
      const launched = await reread(native.request, view.id);
      expect(launched.roundRef).not.toBeNull();
      const receipt = await native.request.get(
        `/api/rounds/${launched.roundRef!.id}`,
      );
      expect(receipt.status()).toBe(200);
      const round = roundViewSchema.parse(await receipt.json());
      expect(round).toMatchObject({
        status: 'scheduled',
        startedAt: null,
        topic: view.topic,
        config: view.config,
      });
      const proof = await assertFrozenLaunch(view);
      const retry = await native.request.post(
        `/api/rooms/${view.id}/commands`,
        {
          headers: { origin },
          data: { type: 'start-round', commandId, expectedVersion },
        },
      );
      expect(retry.status()).toBe(200);
      expect((await retry.json()).receipt.replayed).toBe(true);
      expect((await launchEvidence(view.id)).hash).toBe(proof.hash);
      await expect(judge).toHaveURL(`/rounds/${round.id}`);
      await expect(
        judge.getByText('Round · Not started', { exact: true }),
      ).toBeVisible();
      await judge.goto(`/lobby?${new URLSearchParams({ q: view.title })}`);
      // The judge holds a seat, so the row leads back into the round room.
      await expect(
        judge.getByRole('link', { name: /^Return to room: / }),
      ).toHaveAttribute('href', `/rounds/${round.id}/room`);
      await info.attach('scheduled-round-evidence', {
        body: JSON.stringify(proof),
        contentType: 'application/json',
      });
    } finally {
      await native.close();
    }
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('Train carries its chosen bot through the durable Room into one scheduled Round', async ({
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
      (bot) => bot.label === 'Wren' && bot.seatRole === 'debater',
    );
    expect(opponent?.eligible).toBe(true);
    const roomId = await startTrainPractice(page, opponent!.actorId, 'Wren');
    let view = await reread(page.request, roomId);
    expect(seated(view, opponent!.actorId)).toMatchObject({
      kind: 'bot',
      role: 'negative',
      slot: 0,
    });
    expect(
      seated(view, bots.find((bot) => bot.seatRole === 'judge')!.actorId),
    ).toMatchObject({ role: 'judge', kind: 'bot' });
    expect(view.status).toBe('assembling');

    await page.reload();
    view = await reread(page.request, roomId);
    expect(seated(view, opponent!.actorId)?.role).toBe('negative');
    expect(view.status).toBe('assembling');
    await turnOffPreRoundPrep(page);
    view = await reread(page.request, roomId);
    view = await claim(page, view, 'Affirmative 1');

    // The human host explicitly Readies through the normal Room command;
    // Train itself mints no consent.
    view = await readyOwnSeat(member, view, {
      role: 'affirmative',
      slot: 0,
    });
    const readyAtReceipt = [...view.readiness.readyActorIds];
    const startDraw = await page.request.post(`/api/rooms/${roomId}/commands`, {
      headers: { origin },
      data: {
        type: 'start-pre-round',
        commandId: createId(),
        expectedVersion: view.version,
      },
    });
    const drawReceipt = (await startDraw.json()) as {
      refusal?: string;
      view?: RoomView;
    };
    if (startDraw.status() !== 200) {
      const current = await reread(page.request, roomId);
      await info.attach('train-readiness-loss', {
        body: JSON.stringify({
          candidate: process.env.GIT_COMMIT,
          roomId,
          status: startDraw.status(),
          refusal: drawReceipt.refusal,
          readyAtReceipt,
          readyAtStart: current.readiness.readyActorIds,
          roomVersion: current.version,
        }),
        contentType: 'application/json',
      });
      throw new Error(
        `Train Round start refused after explicit Ready: ${drawReceipt.refusal ?? startDraw.status()}`,
      );
    }
    view = roomViewSchema.parse(drawReceipt.view);
    // The bot's automatic strike may race this browser's room resource. Drive
    // only the existing, authority-checked strike command below, re-reading
    // the authoritative draw before every host-controlled strike.
    for (let strike = 0; strike < 3; strike++) {
      await expect(async () => {
        view = await reread(page.request, roomId);
        expect(
          view.topic !== null ||
            (view.resolutionDraw?.visibility === 'debater' &&
              view.resolutionDraw.turn !== null &&
              view.capabilities.canStrike),
        ).toBe(true);
      }).toPass({ timeout: 30_000 });
      if (view.topic !== null) break;
      if (
        view.resolutionDraw?.visibility !== 'debater' ||
        !view.resolutionDraw.turn ||
        !view.capabilities.canStrike
      )
        throw new Error('Train host cannot read the active draw');
      const draw = view.resolutionDraw;
      const turn = draw.turn;
      if (!turn) throw new Error('Train draw has no active turn');
      const alreadyStruck = new Set(draw.strikes.map((item) => item.position));
      const position = draw.items.find(
        (item) => !alreadyStruck.has(item.position),
      )?.position;
      if (position === undefined)
        throw new Error('Train draw has no available host strike');
      const response = await page.request.post(
        `/api/rooms/${roomId}/commands`,
        {
          headers: { origin },
          data: {
            type: 'strike-resolution',
            commandId: createId(),
            expectedVersion: view.version,
            ordinal: turn.ordinal,
            position,
          },
        },
      );
      expect(response.status()).toBe(200);
      view = roomViewSchema.parse((await response.json()).view);
      if (view.topic !== null) break;
    }
    await expect(async () => {
      view = await reread(page.request, roomId);
      expect(view.topic).not.toBeNull();
    }).toPass({ timeout: 30_000 });

    await page
      .getByRole('button', { name: 'Start round', exact: true })
      .click();
    await expect(page).toHaveURL(/\/rounds\/[a-z0-9]{24}(?:\/room)?$/);
    view = await reread(page.request, roomId);
    expect(view.roundRef).toMatchObject({ status: 'scheduled' });
    const roundId = view.roundRef!.id;
    const roundResponse = await page.request.get(`/api/rounds/${roundId}`);
    expect(roundResponse.status()).toBe(200);
    expect(roundViewSchema.parse(await roundResponse.json())).toMatchObject({
      id: roundId,
      status: 'scheduled',
      topic: view.topic,
    });
    expect(seated(view, opponent!.actorId)?.role).toBe('negative');

    // The member still holds this Room. A repeated Train create returns to
    // the same scheduled Round rather than opening another Room (ADR 0070).
    await page.goto(`/train?bot=${opponent!.actorId}`);
    await page.getByRole('button', { name: 'Start practice' }).click();
    await expect(page).toHaveURL(new RegExp(`/rounds/${roundId}(?:/room)?$`));
    await info.attach('train-scheduled-round-evidence', {
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
        segment.side,
        segment.slot,
        segment.durationMs,
      ]),
    ).toEqual([
      ['N1', 'negative', 0, 41000],
      ['A2', 'affirmative', 1, 53000],
      ['A1', 'affirmative', 0, 47000],
    ]);
    await page.goto(`/rooms/${view.id}`);
    await page.getByText('Manage seats', { exact: true }).click();
    await expect(
      page.getByLabel('Assign Affirmative 2', { exact: true }),
    ).toBeVisible();
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

test('Custom library previews real speech defaults and commits the selected template without JavaScript', async ({
  browser,
}) => {
  await proveFormatPicker(browser);
});

test('Room setup chooses a standard, reads Custom after an edit and goes Back without JavaScript', async ({
  browser,
}) => {
  await proveNoScriptFormatChoice(browser);
});

test('native Lobby search and keyset pages discover beyond the first page without truncation', async ({
  browser,
}) => {
  await proveLobbyDiscovery(browser);
});

test('the plaintext web, realtime and peer upstreams refuse every address but loopback', async () => {
  await proveLoopbackUpstreams();
});
