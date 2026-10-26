import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();

const at = new Date('2026-10-05T12:00:00.000Z');
const earlier = new Date('2026-10-04T12:00:00.000Z');

describe('readMember', () => {
  test('a live member, a nameless account and nobody', async () => {
    const { database } = createTestDatabase([
      [['user-1', 'actor-1', 'debater-a', at]],
      [['user-2', 'actor-2', null, at]],
      [],
    ]);
    assert({
      given: 'a named member, a row with no claimed name, and no row',
      should: 'map the member with an ISO join date, and read nothing else',
      actual: [
        await database.readMember('Debater-A'),
        await database.readMember('someone'),
        await database.readMember('nobody'),
      ],
      expected: [
        {
          userId: 'user-1',
          actorId: 'actor-1',
          username: 'debater-a',
          memberSince: at.toISOString(),
        },
        null,
        null,
      ],
    });
  });
});

describe('readRecordGroups', () => {
  test('grouped seats', async () => {
    const { database, queries } = createTestDatabase([
      [
        ['completed', 'affirmative', 'affirmative', 2],
        ['completed', null, 'negative', 1],
      ],
    ]);
    const groups = await database.readRecordGroups({
      actorId: 'actor-1',
      publicOnly: true,
    });
    assert({
      given: 'two grouped rows for a public reader',
      should: 'map them, filtering on public Rounds played from a Room',
      actual: [
        groups,
        /"visibility" = \$/.test(queries[0]?.query ?? ''),
        /"room_id" is not null/.test(queries[0]?.query ?? ''),
      ],
      expected: [
        [
          {
            status: 'completed',
            outcome: 'affirmative',
            role: 'affirmative',
            rounds: 2,
          },
          { status: 'completed', outcome: null, role: 'negative', rounds: 1 },
        ],
        true,
        true,
      ],
    });
  });
});

describe('readMatchHistory', () => {
  test('a first page with an older page after it', async () => {
    const { database } = createTestDatabase([
      // The snapshot statement.
      [],
      [
        ['round-2', at, 'Motion two', null, 'negative', 'affirmative'],
        ['round-1', earlier, 'Motion one', 'public', null, 'negative'],
      ],
      [
        ['round-2', 'affirmative', 'human', 'debater-a', null],
        ['round-2', 'judge', 'bot', null, 'Judge bot'],
        ['round-2', 'negative', 'human', null, null],
      ],
      [['round-2']],
      [],
    ]);
    const page = await database.readMatchHistory({
      actorId: 'actor-1',
      publicOnly: false,
      before: null,
      limit: 1,
    });
    assert({
      given: 'two Rounds read for a page of one, the shown one forfeited',
      should:
        'show one with its seats and forfeit, null visibility as private, and point at the next page',
      actual: page,
      expected: {
        rows: [
          {
            roundId: 'round-2',
            completedAt: at.toISOString(),
            resolution: 'Motion two',
            visibility: 'private',
            outcome: 'negative',
            role: 'affirmative',
            forfeit: true,
            seats: [
              { role: 'affirmative', kind: 'human', label: 'debater-a' },
              { role: 'judge', kind: 'bot', label: 'Judge bot' },
              { role: 'negative', kind: 'human', label: null },
            ],
          },
        ],
        nextBefore: 'round-2',
      },
    });
  });

  test('an empty history', async () => {
    const { database, queries } = createTestDatabase([[], []]);
    assert({
      given: 'a member with no completed Rounds',
      should: 'answer an empty last page without reading seats',
      actual: [
        await database.readMatchHistory({
          actorId: 'actor-1',
          publicOnly: true,
          before: null,
          limit: 20,
        }),
        queries.length,
      ],
      expected: [{ rows: [], nextBefore: null }, 2],
    });
  });

  test('an older page', async () => {
    const { database, queries } = createTestDatabase([[], [['round-2']], []]);
    const page = await database.readMatchHistory({
      actorId: 'actor-1',
      publicOnly: true,
      before: 'round-2',
      limit: 20,
    });
    assert({
      given: 'a cursor naming a listed Round, with nothing older',
      should:
        'compare (completed_at, id) in SQL against that Round and answer an empty last page',
      actual: [
        page,
        /\("rounds"\."completed_at", "rounds"\."id"\) < \(select c\.completed_at, c\.id from rounds c/.test(
          queries[2]?.query ?? '',
        ),
      ],
      expected: [{ rows: [], nextBefore: null }, true],
    });
  });

  test('refused reads', async () => {
    const { database } = createTestDatabase([[], []]);
    await assertRejects({
      given: 'a cursor naming a Round outside the reader’s list',
      should: 'refuse it as invalid',
      actual: () =>
        database.readMatchHistory({
          actorId: 'actor-1',
          publicOnly: true,
          before: 'round-9',
          limit: 20,
        }),
      code: 'VALIDATION',
    });
    for (const limit of [0, 51, 1.5])
      await assertRejects({
        given: `a page size of ${limit}`,
        should: 'refuse it before any read',
        actual: () =>
          database.readMatchHistory({
            actorId: 'actor-1',
            publicOnly: false,
            before: null,
            limit,
          }),
        code: 'VALIDATION',
      });
  });
});
