import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { validRules } from './testing';
import { practiceRoomConfig } from './reference-formats';
import { createTestDatabase, roomRow } from './index.test-support';

setupRitewayBun();

const roomId = 'r1o2o3m4i5d6e7n8t9i1f5y3';
const roundId = 'r2o8u4n6d8i1d3a5c7t9e2v4';
const rules = validRules;

const roomInput = () => ({
  id: roomId,
  hostActorId: 'host-actor',
  title: 'Proof room',
  topic: 'A motion',
  visibility: 'public' as const,
  formatId: 'foundation',
  formatVersion: 1,
  presetVersion: null,
  competitionType: 'casual' as const,
  length: 'full' as const,
  config: practiceRoomConfig,
  executionPlan: { preRoundPrep: { enabled: false as const } },
  rules,
});

describe('roomOperations', () => {
  test('creates an assembling room and refuses a replayed id', async () => {
    const { database, queries } = createTestDatabase([[roomRow()]]);
    const room = await database.createRoom(roomInput());
    assert({
      given: 'a resolved room insert',
      should: 'persist it as assembling and read the row back',
      actual: room,
      expected: {
        id: roomId,
        formatId: 'foundation',
        formatVersion: 1,
        presetVersion: null,
        competitionType: 'casual',
        length: 'full',
        status: 'assembling',
        rules,
      },
    });
    assert({
      given: 'the insert',
      should: 'carry the frozen rules snapshot',
      actual: queries[0]?.query.includes('rules_snapshot'),
      expected: true,
    });
    const duplicate = Object.assign(
      new Error('duplicate key value violates unique constraint'),
      { code: '23505' },
    );
    const replayed = createTestDatabase([duplicate]);
    await assertRejects({
      given: 'a room id that already exists',
      should: 'refuse with a conflict',
      actual: () => replayed.database.createRoom(roomInput()),
      code: 'CONFLICT',
    });
  });

  test('seats an actor while assembling without claiming readiness after one seat', async () => {
    const { database, queries } = createTestDatabase([
      [['assembling', rules]],
      [],
      [],
    ]);
    await database.seatRoomParticipant({
      roomId,
      participantId: 'seat-1',
      actorId: 'actor-1',
      role: 'affirmative',
      slot: 0,
    });
    assert({
      given: 'an assembling room',
      should:
        'lock it and seat the actor while leaving incomplete assembly open',
      actual: [
        queries[0]?.query.includes('for update'),
        queries[1]?.query.includes('insert into "room_participants"'),
        queries[2]?.query.includes('room_participants'),
        queries.some((query) => query.query.startsWith('update')),
      ],
      expected: [true, true, true, false],
    });
    const started = createTestDatabase([[['started']]]);
    await assertRejects({
      given: 'a room whose assembly has ended',
      should: 'refuse further seating with a conflict',
      actual: () =>
        started.database.seatRoomParticipant({
          roomId,
          participantId: 'seat-2',
          actorId: 'actor-2',
          role: 'negative',
          slot: 0,
        }),
      code: 'CONFLICT',
    });
    const ready = createTestDatabase([[['ready']]]);
    await assertRejects({
      given: 'a room whose declared cast is complete',
      should: 'refuse an extra seat',
      actual: () =>
        ready.database.seatRoomParticipant({
          roomId,
          participantId: 'seat-extra',
          actorId: 'actor-extra',
          role: 'affirmative',
          slot: 1,
        }),
      code: 'CONFLICT',
    });
    const undeclared = createTestDatabase([[['assembling', rules]]]);
    await assertRejects({
      given: 'a slot outside the Room rules',
      should: 'refuse the claim before writing a seat',
      actual: () =>
        undeclared.database.seatRoomParticipant({
          roomId,
          participantId: 'seat-extra',
          actorId: 'actor-extra',
          role: 'affirmative',
          slot: 1,
        }),
      code: 'VALIDATION',
    });
    const missing = createTestDatabase([[]]);
    await assertRejects({
      given: 'a room id that names no room',
      should: 'refuse with not-found',
      actual: () =>
        missing.database.seatRoomParticipant({
          roomId,
          participantId: 'seat-2',
          actorId: 'actor-2',
          role: 'negative',
          slot: 0,
        }),
      code: 'NOT_FOUND',
    });
    const duplicateSeat = Object.assign(
      new Error('duplicate key value violates unique constraint'),
      { code: '23505' },
    );
    const replay = createTestDatabase([[['assembling', rules]], duplicateSeat]);
    await assertRejects({
      given: 'a seat or actor already seated',
      should: 'refuse with a conflict',
      actual: () =>
        replay.database.seatRoomParticipant({
          roomId,
          participantId: 'seat-1',
          actorId: 'actor-1',
          role: 'affirmative',
          slot: 0,
        }),
      code: 'CONFLICT',
    });
  });

  test('freezes a ready room into a scheduled round with its seats', async () => {
    const seatedRules = { ...rules, seats: { ...rules.seats, judge: 1 } };
    const seats = [
      ['seat-1', 'actor-1', 'affirmative', 0],
      ['seat-2', 'actor-2', 'negative', 0],
      ['seat-3', 'actor-3', 'judge', 0],
    ];
    const { database, queries } = createTestDatabase([
      [{ ...roomRow({ status: 'ready' }), 14: seatedRules }],
      seats,
      [],
      [],
      [],
      [[1n, '42']],
      [],
    ]);
    await database.startRound({ roomId, roundId, resolution: 'A resolution' });
    assert({
      given: 'the freeze',
      should: 'insert the round, its seats, and start the room',
      actual: [
        queries[2]?.query.includes('insert into "rounds"'),
        queries[3]?.query.includes('insert into "round_participants"'),
        queries[4]?.query.includes('update'),
        queries.some(
          ({ query, params }) =>
            query.startsWith('insert into "outbox"') &&
            params.some(
              (value) =>
                typeof value === 'object' &&
                value !== null &&
                'kind' in value &&
                value.kind === 'debate.phase-changed',
            ),
        ),
      ],
      expected: [true, true, true, true],
    });
  });

  test('refuses the freeze when a role holds the wrong seats', async () => {
    const shortSeats = [['seat-1', 'actor-1', 'affirmative', 0]];
    const missing = createTestDatabase([
      [roomRow({ status: 'ready' })],
      shortSeats,
    ]);
    await assertRejects({
      given: 'a room whose negative seat never arrived',
      should: 'refuse the freeze with the seat invariant',
      actual: () =>
        missing.database.startRound({
          roomId,
          roundId,
          resolution: 'A resolution',
        }),
      code: 'INVARIANT',
    });
    const notReady = createTestDatabase([[roomRow({ status: 'assembling' })]]);
    await assertRejects({
      given: 'a room that is still assembling',
      should: 'refuse the freeze with a conflict',
      actual: () =>
        notReady.database.startRound({
          roomId,
          roundId,
          resolution: 'A resolution',
        }),
      code: 'CONFLICT',
    });
    const noRoom = createTestDatabase([[]]);
    await assertRejects({
      given: 'a room id that names no room',
      should: 'refuse with not-found',
      actual: () =>
        noRoom.database.startRound({
          roomId,
          roundId,
          resolution: 'A resolution',
        }),
      code: 'NOT_FOUND',
    });
  });
});
