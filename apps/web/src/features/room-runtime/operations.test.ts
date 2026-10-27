import { fixedIds } from '@daisy/clock';
import type { AccountAuthorizationFact } from '@daisy/auth/authorization';
import { createAppError } from '@daisy/errors';
import type { LaunchedRound, RoomCreate } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoomRuntimeOperations, type Store } from './operations';
import {
  account,
  caller,
  makeOperations,
  now,
  launched,
  round,
  state,
  valueFacts,
} from './operations.test-support';

setupRitewayBun();

test('Room runtime reads resolve catalog, cast and collection projections from injected sources', async () => {
  const { operations } = makeOperations();
  const [choices, cast, rooms] = await Promise.all([
    operations.catalog(caller),
    operations.castChoices(caller),
    operations.list(caller, { pageSize: 20, q: '' }),
  ]);
  assert({
    given: 'the pinned catalog, bot roster and visible Room sources',
    should:
      'project legal defaults, withhold human cast entries, and return only lightweight discovery metadata',
    actual: {
      catalog: choices.map((choice) => [
        choice.formatId,
        choice.role,
        choice.family,
        choice.preset.version,
      ]),
      cast: cast.map(({ actorId, eligible }) => [actorId, eligible]),
      rooms: rooms.rooms.map(({ id, seated }) => [id, seated]),
    },
    expected: {
      catalog: [
        ['value', 'standard', null, 1],
        ['proof-template', 'template', 'other', 2],
      ],
      cast: [['b4n6p8r2t4v6x8z1k3b5c7d9', false]],
      rooms: [[state.id, true]],
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
    consentTtlMs: () => 60_000,
    botsAvailable: () => true,
  });
  const view = await withUnavailableRedis.view(caller, state.id);
  const permitted = await base.operations.roundView(caller, round.id);
  const denied = await makeOperations({
    readLaunchedRound: async (
      _id: string,
      _caller: typeof caller,
      authorize: (
        candidate: LaunchedRound,
        fact: AccountAuthorizationFact,
      ) => boolean,
    ) => {
      if (
        !authorize(
          { ...launched, hostActorId: null, participants: [] },
          account,
        )
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
    title: 'A persisted casual room',
    topic: 'Cities should make transit free',
    visibility: 'public',
    selection: {
      kind: 'catalog',
      formatId: 'value',
      formatVersion: 1,
      presetVersion: 1,
      competitionType: 'casual',
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
      readRoomConsent: async () => [{ actorId: caller.actorId, ttlMs: 60000 }],
    } as never,
    ids: fixedIds(['c8n6p8r2t4v6x8z1k3b5c7d9']),
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

test('Room creation decides catalog selections through the one policy (FMT-1)', async () => {
  const create = (selection: RoomCreate['selection']) => {
    const run = makeOperations();
    return run.operations
      .create(caller, {
        commandId: 'c8n6p8r2t4v6x8z1k3b5c7d9',
        title: 'Policy room',
        topic: 'Motion',
        visibility: 'public',
        selection,
      })
      .then(
        () => run.createInput()?.room,
        (error: unknown) => (error as { code?: string }).code,
      );
  };
  const accepted = await create({
    kind: 'catalog',
    formatId: 'value',
    formatVersion: 1,
    presetVersion: 1,
    competitionType: 'casual',
  });
  assert({
    given: 'the current preset of a catalog standard',
    should:
      'create a casual room on the preset config with the selection as its basis and no ranked pin',
    actual: typeof accepted === 'object' && {
      basis: accepted.basis,
      presetVersion: accepted.presetVersion,
      config: accepted.config,
    },
    expected: {
      basis: { formatId: 'value', presetVersion: 1 },
      presetVersion: null,
      config: valueFacts.preset.config,
    },
  });
  assert({
    given: 'a forged preset, and ranked play on an ineligible preset',
    should: 'refuse both before any write',
    actual: [
      await create({
        kind: 'catalog',
        formatId: 'value',
        formatVersion: 1,
        presetVersion: 9,
        competitionType: 'casual',
      }),
      await create({
        kind: 'ranked',
        formatId: 'value',
        formatVersion: 1,
        presetVersion: 1,
      }),
    ],
    expected: ['VALIDATION', 'VALIDATION'],
  });
});
