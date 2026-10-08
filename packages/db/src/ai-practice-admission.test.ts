import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase } from './index.test-support';
import { aiPracticeRoom } from './ai-practice-admission.test-support';

setupRitewayBun();

const admission = () => ({
  room: aiPracticeRoom('room-1', 'foundation', 1),
  seats: [
    { id: 'seat-1', actorId: 'person-1', role: 'affirmative' as const },
    { id: 'seat-2', actorId: 'bot-1', role: 'negative' as const },
    { id: 'seat-3', actorId: 'judge-1', role: 'judge' as const },
  ] as const,
  roundId: 'round-1',
  resolution: 'A motion',
  reservationId: 'reservation-1',
  actorId: 'person-1',
  since: new Date(0),
  limits: { live: 2, perDay: 3 },
});

describe('atomic AI practice admission', () => {
  test('locks and checks both caps before writing the room, cast, round and reservation', async () => {
    const { database, queries } = createTestDatabase([
      [],
      [],
      [[1]],
      [[2]],
      [],
      [],
      [],
      [],
      [],
    ]);
    await database.admitAiPractice(admission());
    assert({
      given: 'an admission below both caps',
      should: 'serialize the check and write one whole practice aggregate',
      actual: queries.map(({ query }) =>
        query.includes('pg_advisory_xact_lock')
          ? 'lock'
          : query.startsWith('select') && query.includes('for update')
            ? 'reclaim'
            : query.includes('count(*)')
              ? 'count'
              : query.match(/insert into "([^"]+)"/)?.[1],
      ),
      expected: [
        'lock',
        'reclaim',
        'count',
        'count',
        'rooms',
        'room_participants',
        'rounds',
        'round_participants',
        'usage_reservations',
      ],
    });
  });

  test('a full live cap leaves no aggregate rows', async () => {
    const { database, queries } = createTestDatabase([[], [], [[2]]]);
    await assertRejects({
      given: 'two live practices against a cap of two',
      should: 'reject before any aggregate insert',
      actual: () => database.admitAiPractice(admission()),
      code: 'RATE_LIMIT',
    });
    assert({
      given: 'the refused live cap',
      should: 'issue only the lock, reclamation and count',
      actual: queries.length,
      expected: 3,
    });
  });

  test('a full daily cap also leaves no aggregate rows', async () => {
    const { database, queries } = createTestDatabase([[], [], [[0]], [[3]]]);
    await assertRejects({
      given: 'three starts today against a cap of three',
      should: 'reject without writing a reservation',
      actual: () => database.admitAiPractice(admission()),
      code: 'RATE_LIMIT',
    });
    assert({
      given: 'the refused daily cap',
      should: 'issue only the lock and two counts',
      actual: queries.length,
      expected: 4,
    });
  });

  test('a changed format cast is refused before the room is created', async () => {
    const { database, queries } = createTestDatabase([[], [], [[0]], [[0]]]);
    const input = admission();
    await assertRejects({
      given: 'a resolved format requiring a second affirmative seat',
      should: 'refuse the three-seat AI cast before any aggregate write',
      actual: () =>
        database.admitAiPractice({
          ...input,
          room: {
            ...input.room,
            rules: {
              ...input.room.rules,
              seats: { ...input.room.rules.seats, affirmative: 2 },
            },
          },
        }),
      code: 'INVARIANT',
    });
    assert({
      given: 'the mismatched cast',
      should: 'stop after the serialized allowance reads',
      actual: queries.length,
      expected: 4,
    });
  });
});
