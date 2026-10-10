import { fixedIds } from '@daisy/clock';
import type { AccountAuthorizationFact } from '@daisy/auth/authorization';
import { createAppError } from '@daisy/errors';
import type { RoomCreate, RoundView } from '@daisy/protocol';
import { oneOnOneFullConfig } from '@daisy/db/reference-formats';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoomRuntimeOperations, type Store } from './operations';
import {
  account,
  caller,
  makeOperations,
  now,
  round,
  state,
} from './operations.test-support';

setupRitewayBun();

test('Room runtime reads resolve catalog, cast and collection projections from injected sources', async () => {
  const { operations } = makeOperations();
  const [choices, cast, rooms] = await Promise.all([
    operations.catalog(caller),
    operations.castChoices(caller),
    operations.list(caller),
  ]);
  assert({
    given: 'the pinned catalog, bot roster and visible Room sources',
    should:
      'project legal defaults, withhold human cast entries, and report current readiness',
    actual: {
      catalog: choices.map((choice) => [
        choice.formatId,
        choice.defaultConfig.speechTiming.countdownMs,
        choice.presets.length,
      ]),
      cast: cast.map(({ actorId, eligible }) => [actorId, eligible]),
      rooms: rooms.map(({ id, readiness, participants }) => [
        id,
        readiness.available,
        participants.map(({ ready }) => ready),
      ]),
    },
    expected: {
      catalog: [
        ['one-on-one', 10_000, 1],
        ['foundation', 0, 0],
      ],
      cast: [['b4n6p8r2t4v6x8z1k3b5c7d9', false]],
      rooms: [[state.id, true, ['ready']]],
    },
  });
});

test('Room runtime distinguishes Redis consent loss and authorizes the canonical private Round projection', async () => {
  const base = makeOperations();
  const withUnavailableRedis = createRoomRuntimeOperations({
    store: base.store,
    redis: {
      setRoomConsent: async () => undefined,
      readRoomConsent: async () => {
        throw new Error('Redis unavailable');
      },
    } as never,
    ids: fixedIds(['c6n6p8r2t4v6x8z1k3b5c7d9']),
    maxOpenRooms: () => 5,
    consentTtlMs: () => 60_000,
    botsAvailable: () => true,
  });
  const view = await withUnavailableRedis.view(caller, state.id);
  const permitted = await base.operations.roundView(caller, round.id);
  const denied = await makeOperations({
    readLaunchedRound: async (
      _id: string,
      _caller: typeof caller,
      authorize: (view: RoundView, fact: AccountAuthorizationFact) => boolean,
    ) => {
      if (
        !authorize({ ...round, hostActorId: null, participants: [] }, account)
      )
        throw createAppError('NOT_FOUND');
      return round;
    },
  })
    .operations.roundView(caller, round.id)
    .then(
      () => false,
      () => true,
    );
  assert({
    given:
      'unavailable ephemeral readiness, a private Round host and an unbound resource',
    should:
      'mark readiness unavailable and leave private access to the canonical evaluator',
    actual: [view.readiness.available, permitted?.id, denied],
    expected: [false, round.id, true],
  });
});

test('Room creation pins resolved rules and replays the accepted receipt before rereading mutable catalog', async () => {
  const body: RoomCreate = {
    commandId: 'c7n6p8r2t4v6x8z1k3b5c7d9',
    title: 'A persisted practice room',
    topic: 'Cities should make transit free',
    visibility: 'public',
    selection: {
      kind: 'catalog',
      formatId: 'one-on-one',
      formatVersion: 1,
      length: 'full',
      competitionType: 'casual',
      config: oneOnOneFullConfig,
    },
  };
  const first = makeOperations();
  const created = await first.operations.create(caller, body);
  const firstRound = first.createInput()?.room.rules;
  let catalogReads = 0;
  const replay = createRoomRuntimeOperations({
    store: {
      readRoomCreateReceipt: async ({
        authorize,
      }: Parameters<Store['readRoomCreateReceipt']>[0]) => {
        if (!authorize(account)) throw createAppError('AUTHORIZATION');
        return {
          commandId: body.commandId,
          roomId: state.id,
          resultingVersion: 1,
          roundRef: null,
          replayed: true,
        };
      },
      listRoomCatalogSources: async () => {
        catalogReads++;
        return [];
      },
      readRoomAssembly: async () => state,
      databaseNow: async () => now,
    } as unknown as Store,
    redis: {
      setRoomConsent: async () => undefined,
      readRoomConsent: async () => [caller.actorId],
    } as never,
    ids: fixedIds(['c8n6p8r2t4v6x8z1k3b5c7d9']),
    maxOpenRooms: () => 5,
    consentTtlMs: () => 60_000,
    botsAvailable: () => true,
  });
  const replayed = await replay.create(caller, body);
  assert({
    given: 'a one-on-one catalog command with one accepted creation receipt',
    should:
      'freeze compiler-resolved judge rules and replay without consulting changed catalog rows',
    actual: {
      launchedRoomId: created.receipt.roomId,
      frozenSeats: firstRound?.seats,
      frozenSegments: firstRound?.segments.map(({ key }) => key),
      replayed: replayed.receipt.replayed,
      catalogReads,
    },
    expected: {
      launchedRoomId: state.id,
      frozenSeats: { affirmative: 1, negative: 1, judge: 1 },
      frozenSegments: ['AC', 'CX1', 'NC', 'CX2', '1AR', 'NR', '2AR'],
      replayed: true,
      catalogReads: 0,
    },
  });
});

test('catalog defaults select declared interaction choices without presets', async () => {
  const definition = {
    ...state.definition,
    configurable: {
      ...state.definition.configurable,
      interaction: {
        crossExModes: ['ordered' as const],
        interruptions: {
          modes: ['enabled' as const],
          minRemainingMs: { min: 1234, max: 5678 },
        },
        yield: { enabledChoices: [true], returnsTimeChoices: [true] },
      },
    },
  };
  const { operations } = makeOperations({
    listRoomCatalogSources: async () => [
      { id: 'custom', name: 'Custom', version: 1, definition, presets: [] },
    ],
  });
  const [choice] = await operations.catalog(caller);
  assert({
    given: 'a format whose only choices enable interruptions and yielding',
    should: 'suggest exactly those legal choices',
    actual: [
      choice?.defaultConfig.interruptions,
      choice?.defaultConfig.yielding,
    ],
    expected: [
      { mode: 'enabled', minRemainingMs: 1234 },
      { allowed: true, returnsTime: true },
    ],
  });
});
