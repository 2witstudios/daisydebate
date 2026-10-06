import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { fakeSql } from './index.test-support';
import {
  closeRefusal,
  withSeasons,
  type SeasonOperations,
  type SeasonRecord,
} from './seasons';

setupRitewayBun();

const startsAt = new Date('2026-10-01T00:00:00.000Z');
const later = new Date('2026-12-31T00:00:00.000Z');

describe('closeRefusal', () => {
  test('allows closing an active season after its start', () => {
    assert({
      given: 'an active season and an end after its start',
      should: 'allow the close',
      actual: closeRefusal({ status: 'active', startsAt }, later),
      expected: null,
    });
  });

  test('refuses everything else with the matching code', () => {
    assert({
      given: 'no season',
      should: 'refuse as not found',
      actual: closeRefusal(null, later),
      expected: 'NOT_FOUND',
    });
    assert({
      given: 'a scheduled or closed season',
      should: 'refuse as a conflict',
      actual: [
        closeRefusal({ status: 'scheduled', startsAt }, later),
        closeRefusal({ status: 'closed', startsAt }, later),
      ],
      expected: ['CONFLICT', 'CONFLICT'],
    });
    assert({
      given: 'an end at or before the start',
      should: 'refuse as invalid',
      actual: closeRefusal({ status: 'active', startsAt }, startsAt),
      expected: 'VALIDATION',
    });
  });
});

// Schema-definition column order; the driver returns rows positionally and
// timestamptz values as Dates.
const seasonRow = (
  id: string,
  status: string,
  endsAt: string | null = null,
  version = 1,
) => [
  id,
  'Season 1',
  startsAt,
  endsAt === null ? null : new Date(endsAt),
  status,
  startsAt,
  startsAt,
  version,
];

const record = (
  id: string,
  status: SeasonRecord['status'],
  endsAt: string | null = null,
  version = 1,
): SeasonRecord => ({
  id,
  name: 'Season 1',
  startsAt: '2026-10-01T00:00:00.000Z',
  endsAt,
  status,
  version,
});

const scripted = <T>(
  script: Parameters<typeof fakeSql>[0],
  work: (seasons: SeasonOperations) => Promise<T>,
) => {
  const { client, queries } = fakeSql(script);
  return {
    result: withSeasons('postgresql://unit@127.0.0.1:1/unit', work, client),
    queries,
  };
};

const uniqueViolation = () =>
  Object.assign(new Error('duplicate key'), { errno: '23505' });

describe('season operations', () => {
  test('lists and opens seasons as records', async () => {
    assert({
      given: 'one stored season',
      should: 'list it as a record',
      actual: await scripted(
        [[seasonRow('s1', 'closed', '2026-12-31T00:00:00.000Z')]],
        (seasons) => seasons.listSeasons(),
      ).result,
      expected: [record('s1', 'closed', '2026-12-31T00:00:00.000Z')],
    });
    assert({
      given: 'no active season',
      should: 'return the opened season',
      actual: await scripted([[seasonRow('s2', 'active')]], (seasons) =>
        seasons.openSeason({ id: 's2', name: 'Season 1', startsAt }),
      ).result,
      expected: record('s2', 'active'),
    });
  });

  test('maps a second active season to a conflict', async () => {
    await assertRejects({
      given: 'the single-active index refusing the insert',
      should: 'refuse as a conflict',
      actual: () =>
        scripted([uniqueViolation()], (seasons) =>
          seasons.openSeason({ id: 's3', name: 'Season 1', startsAt }),
        ).result,
      code: 'CONFLICT',
    });
  });

  test('closes the locked active season and refuses without writing', async () => {
    const closing = scripted(
      [
        [seasonRow('s1', 'active')],
        [seasonRow('s1', 'closed', later.toISOString(), 2)],
      ],
      (seasons) => seasons.closeSeason({ id: 's1', endsAt: later }),
    );
    assert({
      given: 'the active season',
      should: 'return it closed at the next version',
      actual: await closing.result,
      expected: record('s1', 'closed', later.toISOString(), 2),
    });
    const missing = scripted([[]], (seasons) =>
      seasons.closeSeason({ id: 'nope', endsAt: later }),
    );
    await assertRejects({
      given: 'no such season',
      should: 'refuse as not found',
      actual: () => missing.result,
      code: 'NOT_FOUND',
    });
    assert({
      given: 'a refused close',
      should: 'stop after the locking read',
      actual: missing.queries.filter(({ query }) => query.startsWith('update'))
        .length,
      expected: 0,
    });
  });

  test('rolls over by closing at the next start and opening', async () => {
    const { result } = scripted(
      [
        [seasonRow('s1', 'active')],
        [seasonRow('s1', 'closed', later.toISOString(), 2)],
        [seasonRow('s2', 'active')],
      ],
      (seasons) =>
        seasons.rolloverSeason({
          closeId: 's1',
          open: { id: 's2', name: 'Season 1', startsAt: later },
        }),
    );
    assert({
      given: 'an active season and a later next start',
      should: 'return the closed and the opened season',
      actual: await result,
      expected: {
        closed: record('s1', 'closed', later.toISOString(), 2),
        opened: record('s2', 'active'),
      },
    });
  });
});
