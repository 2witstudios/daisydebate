import { authorize } from '@daisy/auth/authorization';
import { createTabStore, type CreateLobbyRoomCommand } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { isAppError } from '@daisy/errors';
import { createLobbyRoom } from '../src/features/tab/operations/create-lobby-room';
import { readStandingRoomDraft } from '../src/features/tab/reads/standing-room-draft';
import { settingCommand } from '../src/features/tab/operations/settings';
import { readLeagueLadder } from '../src/features/ratings/read-league-ladder';
import { withRoomRuntime } from './room-runtime.test-support';
import { createRoundRuntimeOperations } from '../src/features/round-runtime/operations';
import { judgeSeat, sideSeat } from '@daisy/protocol';
import type { SettingCommand } from '@daisy/protocol/lobby/setting-command';
import { as } from './tab-tournament-organization-wiring.test-support';
import type { World } from './tab-tournament.test-support';

export async function nativeRoomCases(
  world: World,
  original: CreateLobbyRoomCommand,
  roomId: string,
) {
  const store = createTabStore(world.database);
  const dependencies = {
    store,
    authorize,
    now: world.clock.now,
    newId: createId,
  };
  const principal = as(world.bots.Coach!);
  const director = as(world.bots.Director!);
  const lobbyId = original.lobbyId;
  const read = readStandingRoomDraft(dependencies);
  const send = createLobbyRoom(dependencies);
  const body = (command: CreateLobbyRoomCommand = original) => {
    const commandId = createId();
    return {
      version: 1 as const,
      commandId,
      expected: {},
      command: { ...command, room: { ...command.room, commandId } },
    };
  };
  const counts = async () =>
    Promise.all([
      world.sql`select count(*)::int n from rooms where lobby_id=${lobbyId}`,
      world.sql`select count(*)::int n from action_history where type='create-lobby-room'`,
      world.sql`select count(*)::int n from outbox`,
    ]);
  const [uncastRoom] =
    await world.sql`select version from rooms where id=${roomId}`;
  const [uncastHistory] =
    await world.sql`select resulting_version, result from action_history where aggregate_id=${roomId} and type='create-lobby-room'`;
  assert({
    given: 'an accepted Room create without an initial cast',
    should: 'retain version one in the Room and durable receipt',
    actual: [
      Number(uncastRoom!.version),
      Number(uncastHistory!.resulting_version),
      uncastHistory!.result.resultingVersion,
    ],
    expected: [1, 1, 1],
  });
  const unchanged = await counts();
  for (const [command, refusal] of [
    [
      {
        ...original,
        room: { ...original.room, visibility: 'public' as const },
      },
      'setting-enforced',
    ],
    [{ ...original, templateId: createId() }, 'template-not-offered'],
    [{ ...original, poolResolutionId: createId() }, 'pool-resolution-required'],
    [
      {
        ...original,
        config: {
          ...original.config!,
          speechTiming: {
            ...original.config!.speechTiming,
            countdownMs: original.config!.speechTiming.countdownMs + 1,
          },
        },
      },
      'setting-enforced',
    ],
  ] as const) {
    assert({
      given: `a create request violating ${refusal}`,
      should: 'refuse by name without a Room, history or doorbell',
      actual: [await send(principal, body(command)), await counts()],
      expected: [{ kind: 'refused', refusal }, unchanged],
    });
  }
  const setting = settingCommand(dependencies);
  const set = async (command: SettingCommand) => {
    const [version] =
      await world.sql`select settings_version from lobbies where id=${lobbyId}`;
    const answer = await setting(director, {
      version: 1,
      commandId: createId(),
      expected: { settings: Number(version!.settings_version) },
      command,
    });
    if (answer.kind !== 'accepted')
      throw new Error(`native setting: ${JSON.stringify(answer)}`);
  };
  for (const policy of ['off', 'on'] as const) {
    await set({
      type: 'set-setting',
      scope: { kind: 'lobby', id: lobbyId },
      key: 'recording.capture',
      value: { value: policy },
      hold: 'enforced',
    });
    const policyRead = await read(principal, {
      lobbyId,
      templateId: original.templateId!,
    });
    assert({
      given: `an enforced Recording ${policy} policy on the actual Room chain`,
      should: 'publish its exact value and lock in native creation metadata',
      actual: policyRead?.creation?.recording,
      expected: { value: policy, locked: true },
    });
    const policyCounts = await counts();
    const requests: CreateLobbyRoomCommand[] =
      policy === 'off'
        ? [
            {
              ...original,
              room: { ...original.room, recordingPolicy: 'officials' },
            },
          ]
        : [
            { ...original, room: { ...original.room } },
            { ...original, room: { ...original.room, recordingPolicy: 'off' } },
          ];
    for (const request of requests) {
      assert({
        given: `a requested Recording ${request.room.recordingPolicy ?? 'omitted'} against enforced ${policy}`,
        should:
          'refuse before assembly without a Room, history or outbox write',
        actual: [await send(principal, body(request)), await counts()],
        expected: [
          { kind: 'refused', refusal: 'setting-enforced' },
          policyCounts,
        ],
      });
    }
  }
  await set({
    type: 'clear-setting',
    scope: { kind: 'lobby', id: lobbyId },
    key: 'recording.capture',
  });
  await set({
    type: 'set-setting',
    scope: { kind: 'lobby', id: lobbyId },
    key: 'resolution.own_text',
    value: { value: 'off' },
    hold: 'enforced',
  });
  assert({
    given: 'a current own-text prohibition',
    should:
      'reject custom text even when its wording matches a pool without its exact id',
    actual: await send(principal, body()),
    expected: { kind: 'refused', refusal: 'pool-resolution-required' },
  });
  const loaded = await read(principal, {
    lobbyId,
    templateId: original.templateId!,
  });
  const pool = loaded!.creation!.resolutionChoicePolicy.choices[0]!;
  const poolCommand = {
    ...original,
    poolResolutionId: pool.id,
    room: {
      ...original.room,
      resolution: { kind: 'custom' as const, text: pool.text },
    },
  };
  const poolAccepted = await send(principal, body(poolCommand));
  if (poolAccepted.kind !== 'accepted')
    throw new Error(`pool create: ${JSON.stringify(poolAccepted)}`);
  assert({
    given:
      'an exact current pool id and immutable wording while own text is off',
    should: 'create the named source and reject a mismatching wording',
    actual: [
      (
        await world.sql`select topic from rooms where id=${poolAccepted.receipt.aggregate.id}`
      )[0]!.topic,
      await send(
        principal,
        body({
          ...poolCommand,
          room: {
            ...poolCommand.room,
            resolution: {
              kind: 'custom',
              text: 'A forged matching-source claim.',
            },
          },
        }),
      ),
    ],
    expected: [
      pool.text,
      { kind: 'refused', refusal: 'pool-resolution-required' },
    ],
  });
  await set({
    type: 'set-setting',
    scope: { kind: 'lobby', id: lobbyId },
    key: 'room.timing',
    value: { preRoundPrepMs: 0, inRoundPrepMsPerSide: 0, countdownMs: 1000 },
    hold: 'enforced',
  });
  const beforeStale = await counts();
  assert({
    given: 'a displayed config whose timing policy changed before submit',
    should: 'refuse the stale values without silently replacing them',
    actual: [await send(principal, body(poolCommand)), await counts()],
    expected: [{ kind: 'refused', refusal: 'setting-enforced' }, beforeStale],
  });
  const current = await read(principal, {
    lobbyId,
    templateId: original.templateId!,
  });
  const fresh = { ...poolCommand, config: current!.creation!.config };
  const heldBody = body({
    ...fresh,
    room: {
      ...fresh.room,
      cast: [
        { actorId: world.bots.Coach!.actorId, seat: sideSeat('affirmative') },
      ],
    },
  });
  const held = await send(principal, heldBody);
  if (held.kind !== 'accepted')
    throw new Error(`held seat: ${JSON.stringify(held)}`);
  const [castRoom] =
    await world.sql`select version from rooms where id=${held.receipt.aggregate.id}`;
  const [castHistory] =
    await world.sql`select resulting_version, result from action_history where command_id=${heldBody.commandId}`;
  assert({
    given: 'an accepted Room create with one initial cast seat',
    should: 'return and persist the canonical assembled version and replay it',
    actual: [
      Number(castRoom!.version),
      held.receipt.resultingVersion,
      Number(castHistory!.resulting_version),
      castHistory!.result.resultingVersion,
      await send(principal, heldBody),
    ],
    expected: [
      2,
      2,
      2,
      2,
      { ...held, receipt: { ...held.receipt, replayed: true } },
    ],
  });
  const beforeActive = await counts();
  let reason: string | undefined;
  try {
    await send(
      principal,
      body({
        ...fresh,
        room: {
          ...fresh.room,
          cast: [
            {
              actorId: world.bots.Coach!.actorId,
              seat: sideSeat('affirmative'),
            },
          ],
        },
      }),
    );
  } catch (error) {
    if (!isAppError(error)) throw error;
    reason = error.reason;
  }
  assert({
    given: 'a cast actor already held by another open Room',
    should: 'retain that active seat and roll back the entire refused create',
    actual: [
      reason,
      await counts(),
      (
        await world.sql`select room_id from active_seats where actor_id=${world.bots.Coach!.actorId}`
      )[0]!.room_id,
    ],
    expected: ['active-room', beforeActive, held.receipt.aggregate.id],
  });
  const beforeCapture = await counts();
  reason = undefined;
  try {
    await send(
      principal,
      body({ ...fresh, room: { ...fresh.room, recordingPolicy: 'officials' } }),
    );
  } catch (error) {
    if (!isAppError(error)) throw error;
    reason = error.reason;
  }
  assert({
    given: 'a nonpremium member requesting a Recording',
    should: 'use canonical capture refusal and leave no Room or history',
    actual: [reason, await counts()],
    expected: ['capture-premium', beforeCapture],
  });

  if (!world.runtimeDatabaseUrl)
    throw new Error('native rating proof needs committed resource');
  await withRoomRuntime(
    async (f) => {
      let view = await f.operations.view(world.bots.Coach!, roomId);
      for (const [side, person] of [
        ['affirmative', world.bots['Debater 1']!],
        ['negative', world.bots['Debater 2']!],
      ] as const)
        view = (
          await f.command(person, view, {
            type: 'claim-seat',
            seat: sideSeat(side),
          })
        ).view;
      const judge = await f.command(world.bots['Judge A']!, view, {
        type: 'claim-seat',
        seat: judgeSeat(),
      });
      view = judge.view;
      for (const person of [
        world.bots['Debater 1']!,
        world.bots['Debater 2']!,
        world.bots['Judge A']!,
      ])
        view = (
          await f.consent(
            person,
            await f.operations.view(person, roomId),
            'ready',
          )
        ).view;
      await f.command(world.bots.Coach!, view, { type: 'start-round' });
      const [frozen] =
        await world.sql`select id,league_ladder_id,ladder_id from rounds where room_id=${roomId}`;
      const round = (await f.store.getRound(String(frozen!.id)))!;
      const debater = round.participants.find(
        (person) => person.actorId === world.bots['Debater 1']!.actorId,
      )!;
      await createRoundRuntimeOperations({
        store: f.store,
        nextSegmentId: createId,
      }).command({ kind: 'human', actorId: debater.actorId! }, round.id, {
        version: 1,
        commandId: createId(),
        expectedVersion: round.version,
        command: { type: 'forfeit', participantId: debater.id },
      });
      assert({
        given:
          'a Room made by the native Tab command, then real Ready/Start/forfeit',
        should:
          'freeze only its own league ladder and publish two league standings without a Daisy ledger write',
        actual: [
          frozen!.league_ladder_id !== null,
          frozen!.ladder_id,
          (await readLeagueLadder({ store, authorize })(principal, { lobbyId }))
            ?.entrants,
          (
            await world.sql`select count(*)::int n from rating_changes where round_id=${round.id}`
          )[0]!.n,
        ],
        expected: [true, null, 2, 0],
      });
    },
    { databaseUrl: world.runtimeDatabaseUrl },
  );
}
