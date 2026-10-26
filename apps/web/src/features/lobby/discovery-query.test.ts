import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  defaultLobbyFilters,
  isFiltered,
  lobbyHref,
  parseLobbyQuery,
  parseRoomDiscoveryQuery,
} from './discovery-query';
setupRitewayBun();

const cursor = 'a'.repeat(24);

test('native Lobby selects recognized discovery query keys', () => {
  const result = parseRoomDiscoveryQuery({
    q: ' Room ',
    pageSize: '1',
    utm_source: ['a', 'b'],
    next: '/lobby',
  });
  assert({
    given: 'padded search with unrelated URL keys',
    should: 'parse only the native discovery query',
    actual: result.success ? result.data : null,
    expected: { q: 'Room', pageSize: 1 },
  });
  const invalid = [
    { q: ['a', 'b'] },
    { cursor: ['a', 'b'] },
    { pageSize: ['1', '2'] },
    { pageSize: '01' },
    { pageSize: '51' },
    { cursor: 'invalid' },
  ];
  assert({
    given: 'repeated or malformed recognized native keys',
    should: 'refuse without coercion or first-value selection',
    actual: invalid.map((value) => parseRoomDiscoveryQuery(value).success),
    expected: invalid.map(() => false),
  });
});

describe('parseLobbyQuery', () => {
  test('reads the listing and the filters together', () => {
    const result = parseLobbyQuery({
      q: 'motion',
      status: 'live',
      mode: 'ranked',
      length: 'quick',
    });
    assert({
      given: 'a search with a status, mode and length',
      should: 'carry the listing query and every filter',
      actual: result,
      expected: {
        success: true,
        data: {
          list: { q: 'motion', pageSize: 20 },
          filters: { status: 'live', mode: 'ranked', length: 'quick' },
        },
      },
    });
  });

  test('falls back to defaults on unknown filter values', () => {
    assert({
      given: 'unknown, repeated or missing filter values',
      should: 'use the default for each, never throw',
      actual: [
        parseLobbyQuery({ status: 'closed', mode: ['ranked', 'casual'] }),
        parseLobbyQuery({ length: 'endless', event: 'league' }),
      ].map((result) => (result.success ? result.data.filters : null)),
      expected: [defaultLobbyFilters, defaultLobbyFilters],
    });
  });

  test('refuses a malformed listing query', () => {
    assert({
      given: 'a malformed cursor beside valid filters',
      should: 'refuse the whole query',
      actual: parseLobbyQuery({ cursor: 'bad', status: 'open' }).success,
      expected: false,
    });
  });
});

describe('lobbyHref', () => {
  const base = parseLobbyQuery({});
  const query = base.success ? base.data : null;

  test('carries only what differs from the defaults', () => {
    assert({
      given: 'the default query, then a search, a status and a page size',
      should: 'give /lobby, then only the set keys',
      actual: query
        ? [
            lobbyHref(query),
            lobbyHref({
              list: { q: 'tax', pageSize: 5 },
              filters: { ...defaultLobbyFilters, status: 'open' },
            }),
          ]
        : null,
      expected: ['/lobby', '/lobby?q=tax&pageSize=5&status=open'],
    });
  });

  test('pages forward with a cursor and keeps the filters', () => {
    assert({
      given: 'a filtered query and the next cursor',
      should: 'add the cursor after the filters',
      actual: lobbyHref(
        {
          list: { q: '', pageSize: 20, cursor },
          filters: { ...defaultLobbyFilters, mode: 'casual' },
        },
        cursor,
      ),
      expected: `/lobby?mode=casual&cursor=${cursor}`,
    });
  });
});

describe('isFiltered', () => {
  test('is true only when a mode or length is set', () => {
    assert({
      given: 'the default filters, a status alone, and a length',
      should: 'count mode and length, not the status tab',
      actual: [
        isFiltered(defaultLobbyFilters),
        isFiltered({ ...defaultLobbyFilters, status: 'live' }),
        isFiltered({ ...defaultLobbyFilters, length: 'full' }),
      ],
      expected: [false, false, true],
    });
  });
});
