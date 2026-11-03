import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { fakeSql } from './index.test-support';
import {
  withSeasons,
  type SeasonOperations,
  type SeasonRecord,
} from './seasons';

setupRitewayBun();

const startsAt = new Date('2026-10-01T00:00:00.000Z');

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
  null,
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
      actual: await scripted([[], [], [seasonRow('s2', 'active')]], (seasons) =>
        seasons.openSeason({ id: 's2', name: 'Season 1', startsAt }),
      ).result,
      expected: record('s2', 'active'),
    });
  });

  test('refuses to open a season while any season exists (DEC-111)', async () => {
    const refused = scripted([[], [{ id: 's1' }]], (seasons) =>
      seasons.openSeason({ id: 's3', name: 'Season 2', startsAt }),
    );
    await assertRejects({
      given: 'an earlier season, active or closed',
      should: 'refuse as a conflict',
      actual: () => refused.result,
      code: 'CONFLICT',
    });
    assert({
      given: 'a refused open',
      should: 'insert nothing',
      actual: refused.queries.filter(({ query }) => query.startsWith('insert'))
        .length,
      expected: 0,
    });
  });

  test('refuses to close a season pending DEC-111, with no SQL', async () => {
    const refused = scripted([], (seasons) => seasons.closeSeason());
    await assertRejects({
      given: 'any attempt to close while DEC-111 is open',
      should: 'refuse as a conflict',
      actual: () => refused.result,
      code: 'CONFLICT',
    });
    assert({
      given: 'the refused close',
      should: 'issue no SQL',
      actual: refused.queries.length,
      expected: 0,
    });
  });
});
