import { assert, setupRitewayBun, test } from 'riteway/bun';
import { foundationDefinition } from './reference-formats';
import {
  accountFact,
  caller,
  room,
} from './room-command-operations.test-support';
import { createTestDatabase, roomRow, validRules } from './index.test-support';

setupRitewayBun();

test('Room create command writes its receipt and exactly one change event', async () => {
  const account = accountFact();
  const { database, queries } = createTestDatabase([
    [account],
    [account],
    [],
    [],
    [],
    [[0]],
    [],
    [],
    [{ now: new Date('2026-10-09T00:00:00.000Z') }],
    [],
    [],
    [[1n, '42']],
    [],
  ]);

  const receipt = await database.createRoomCommand({
    room,
    maxOpenRooms: 5,
    commandId: 'c4a2b6d8f1h3j5k7m9n2p4r6',
    payloadDigest: 'a'.repeat(64),
    definition: foundationDefinition,
    caller,
    authorize: (fact) => fact?.member === true && fact.erased === false,
  });

  assert({
    given: 'an authorized host and an available open-Room quota',
    should: 'persist an assembling Room with its accepted command receipt',
    actual: [
      receipt,
      queries.filter(({ query }) => query.includes('pg_notify')).length,
    ],
    expected: [
      {
        commandId: 'c4a2b6d8f1h3j5k7m9n2p4r6',
        roomId: room.id,
        resultingVersion: 1,
        roundRef: null,
        replayed: false,
      },
      1,
    ],
  });
});

test('Start mutation commits one frozen Round, cast, receipt, and change signal', async () => {
  const secondActorId = 'c2a4e6f8h1j3k5m7n9p2r4t6';
  const roundId = 'c3a1d5f7h9j2k4m6n8p1r3t5';
  const readyRoom = { ...room, rules: validRules };
  const { database, queries } = createTestDatabase([
    [[caller.actorId], [secondActorId]],
    [accountFact(), accountFact(secondActorId, 'c4a2b6d8f1h3j5k7m9n2p4r6', 2)],
    [accountFact()],
    [],
    [
      roomRow({
        id: readyRoom.id,
        hostActorId: caller.actorId,
        title: readyRoom.title,
        topic: readyRoom.topic,
        visibility: readyRoom.visibility,
        formatId: readyRoom.formatId,
        config: readyRoom.config,
        executionPlan: readyRoom.executionPlan,
        rulesSnapshot: readyRoom.rules,
        status: 'ready',
      }),
    ],
    [[foundationDefinition]],
    [
      [
        'c5a1b3d7e9f2h4j6k8m1n3p5',
        readyRoom.id,
        caller.actorId,
        'affirmative',
        0,
        'r1',
        0,
      ],
      [
        'c6a4e2f8h1j3k5m7n9p2r4t6',
        readyRoom.id,
        secondActorId,
        'negative',
        0,
        'r2',
        0,
      ],
    ],
    [[caller.actorId, 'human', 'Host', null, true, null]],
    [[secondActorId, 'human', 'Other', null, true, null]],
    [[caller.actorId, 'human', 'Host', null, true, null]],
    [],
    [],
    [{ now: new Date('2026-10-09T00:00:00.000Z') }],
    [],
    [],
    [],
    [],
    [],
    [[2n, '42']], // Round phase signal for the frozen scheduled Round
    [],
    [], // command receipt insert follows the Round phase signal
    [[1n, '42']],
    [],
  ]);

  const receipt = await database.executeRoomCommand({
    caller,
    authorizeRead: (candidate, fact) =>
      fact?.member === true && candidate.hostActorId === caller.actorId,
    roomId: readyRoom.id,
    actorId: caller.actorId,
    commandId: 'c7a5d3f1h9j2k4m6n8p1r3t5',
    payloadDigest: 'b'.repeat(64),
    type: 'start-round',
    targetActorId: null,
    roundId,
    execute: async (state) => ({
      ok: true,
      mutation: {
        state: {
          ...state,
          status: 'started',
          version: state.version + 1,
          changeVersion: state.changeVersion + 1,
        },
        consent: null,
        freeze: true,
        publishDefinition: false,
      },
    }),
  });

  assert({
    given: 'a complete current cast accepted by the Room policy',
    should: 'freeze the stored Round and cast with one accepted change receipt',
    actual: [
      receipt,
      queries.filter(({ query }) => query.includes('insert into "rounds"'))
        .length,
      queries.filter(({ query }) =>
        query.includes('insert into "round_participants"'),
      ).length,
      queries
        .filter(({ query }) => query.startsWith('insert into "outbox"'))
        .map(({ params }) =>
          params.find((value) => typeof value === 'object' && value !== null),
        ),
      queries.filter(({ query }) => query.includes('pg_notify')).length,
    ],
    expected: [
      {
        commandId: 'c7a5d3f1h9j2k4m6n8p1r3t5',
        roomId: readyRoom.id,
        resultingVersion: 2,
        roundRef: { id: roundId, status: 'scheduled' },
        replayed: false,
      },
      1,
      1,
      [
        {
          kind: 'debate.phase-changed',
          ids: [roundId],
          entityVersion: 1,
        },
        {
          kind: 'room.changed',
          ids: [readyRoom.id],
          entityVersion: 2,
        },
      ],
      2,
    ],
  });
});
