import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();

const at = new Date('2026-10-05T12:00:00.000Z');

describe('standings reads', () => {
  test('lists ladder seasons and ranked formats as records', async () => {
    const { database } = createTestDatabase([
      [['s2', 'Season 2', at, null, 'active', at, at, 1]],
      [['parli', 'Parliamentary']],
    ]);
    assert({
      given: 'one active season row and one ranked format row',
      should: 'map them to records',
      actual: [
        await database.listLadderSeasons(),
        await database.listRankedFormats(),
      ],
      expected: [
        [
          {
            id: 's2',
            name: 'Season 2',
            startsAt: at.toISOString(),
            endsAt: null,
            status: 'active',
            version: 1,
          },
        ],
        [{ id: 'parli', name: 'Parliamentary' }],
      ],
    });
  });

  test('reads nothing for no seasons', async () => {
    const { database, queries } = createTestDatabase([]);
    assert({
      given: 'no seasons to read',
      should: 'return empty standings without a query',
      actual: [
        await database.readStandings({
          formatId: 'parli',
          ladder: 'ranked',
          seasonIds: [],
        }),
        queries.length,
      ],
      expected: [{ ratings: [], changes: [] }, 0],
    });
  });

  test('maps rating and ledger rows', async () => {
    const { database } = createTestDatabase([
      // The snapshot's SET TRANSACTION statement.
      [],
      [
        ['s1', 'a1', 'ada', 1516, 290],
        ['s1', 'a2', null, 1484, 290],
      ],
      [
        ['s1', 'a1', 'd1', 1500, 1516, at, 'affirmative', 'affirmative'],
        ['s1', 'a2', 'd1', 1500, 1484, at, 'negative', 'affirmative'],
        ['s1', 'a1', 'd2', 1516, 1516, at, 'affirmative', 'draw'],
      ],
    ]);
    const read = await database.readStandings({
      formatId: 'parli',
      ladder: 'ranked',
      seasonIds: ['s1'],
    });
    assert({
      given: 'a named and a tombstoned debater',
      should: 'keep the null name',
      actual: read.ratings.map(({ username }) => username),
      expected: ['ada', null],
    });
    assert({
      given: 'ledger rows with seats and outcomes',
      should: 'carry the role, outcome and ISO posting time',
      actual: read.changes.map(({ role, outcome, occurredAt }) => [
        role,
        outcome,
        occurredAt,
      ]),
      expected: [
        ['affirmative', 'affirmative', at.toISOString()],
        ['negative', 'affirmative', at.toISOString()],
        ['affirmative', 'draw', at.toISOString()],
      ],
    });
  });

  test('reads both sets from one read-only snapshot', async () => {
    const { database, queries } = createTestDatabase([[], [], []]);
    await database.readStandings({
      formatId: 'parli',
      ladder: 'ranked',
      seasonIds: ['s1'],
    });
    assert({
      given: 'a standings read',
      should: 'run its selects in one repeatable-read, read-only transaction',
      actual: queries.some(
        ({ query }) =>
          /repeatable read/i.test(query) && /read only/i.test(query),
      ),
      expected: true,
    });
  });

  test('refuses a posting that cannot be rated', async () => {
    for (const [given, role, outcome] of [
      ['a judge seat', 'judge', 'affirmative'],
      ['an abandoned outcome', 'affirmative', 'abandoned'],
      ['no outcome', 'negative', null],
    ] as const) {
      const { database } = createTestDatabase([
        [],
        [],
        [['s1', 'a1', 'd1', 1500, 1516, at, role, outcome]],
      ]);
      await assertRejects({
        given: `a ledger row with ${given}`,
        should: 'refuse as an internal error rather than guess a result',
        actual: () =>
          database.readStandings({
            formatId: 'parli',
            ladder: 'ranked',
            seasonIds: ['s1'],
          }),
        code: 'INTERNAL',
      });
    }
  });
});
