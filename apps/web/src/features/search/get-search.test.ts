import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getSearch } from './get-search';

setupRitewayBun();

const now = '2026-10-03T12:00:00.000Z';

describe('getSearch', () => {
  test('a name in the sample data', () => {
    const results = getSearch({ q: 'tuesday' }, now);
    assert({
      given: 'a query that names a sample room',
      should: 'find it under rooms',
      actual: results.groups.some((group) => group.kind === 'room'),
      expected: true,
    });
  });

  test('no query', () => {
    assert({
      given: 'no query',
      should: 'return no hits',
      actual: getSearch({}, now).total,
      expected: 0,
    });
  });
});
