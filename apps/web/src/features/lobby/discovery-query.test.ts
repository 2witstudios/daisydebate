import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  isFiltered,
  lobbyHref,
  lobbyModeChoices,
  lobbyStatusChoices,
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

test('the Lobby status and mode filters narrow the canonical listing', () => {
  const parsed = (raw: Record<string, string | string[]>) => {
    const result = parseRoomDiscoveryQuery(raw);
    return result.success ? result.data : null;
  };
  assert({
    given:
      'a live ranked filter, the every-status and any-mode choices, and unknown or repeated values',
    should:
      'carry the narrowing filters, drop the choices that narrow nothing, and refuse the rest',
    actual: [
      parsed({ status: 'live', mode: 'ranked' }),
      parsed({ status: 'all', mode: 'any' }),
      parsed({ status: 'finished' }),
      parsed({ mode: ['ranked', 'casual'] }),
    ],
    expected: [
      { q: '', pageSize: 20, status: 'live', mode: 'ranked' },
      { q: '', pageSize: 20 },
      null,
      null,
    ],
  });
});

describe('Lobby choices', () => {
  test('come from the protocol vocabulary', () => {
    assert({
      given: 'the status tabs and the mode select',
      should:
        'offer every status, then each listing status, and any, then each competition type',
      actual: [lobbyStatusChoices, lobbyModeChoices],
      expected: [
        ['all', 'open', 'starting', 'live'],
        ['any', 'ranked', 'casual'],
      ],
    });
  });
});

describe('lobbyHref', () => {
  const query = {
    q: 'tax',
    pageSize: 5,
    status: 'open',
    mode: 'ranked',
  } as const;

  test('a filter change starts on the first page', () => {
    assert({
      given: 'a searched, sized and filtered query with no cursor',
      should: 'carry every non-default value and no cursor',
      actual: lobbyHref(query),
      expected: '/lobby?q=tax&pageSize=5&status=open&mode=ranked',
    });
  });

  test('the next page keeps the filters', () => {
    assert({
      given: 'the same query and the next cursor',
      should: 'add the cursor after the filters',
      actual: lobbyHref(query, cursor),
      expected: `/lobby?q=tax&pageSize=5&status=open&mode=ranked&cursor=${cursor}`,
    });
  });

  test('nothing narrowed is the bare Lobby', () => {
    assert({
      given: 'the default query',
      should: 'link /lobby',
      actual: lobbyHref({ q: '', pageSize: 20 }),
      expected: '/lobby',
    });
  });
});

describe('isFiltered', () => {
  test('only the Filters panel counts', () => {
    assert({
      given: 'a mode, a status tab, and nothing',
      should: 'count the mode only',
      actual: [
        isFiltered({ q: '', pageSize: 20, mode: 'casual' }),
        isFiltered({ q: '', pageSize: 20, status: 'live' }),
        isFiltered({ q: '', pageSize: 20 }),
      ],
      expected: [true, false, false],
    });
  });
});

test('Lobby query URLs preserve the server sort and restart the cursor separately', () => {
  const parsed = parseRoomDiscoveryQuery({ sort: 'longest-waiting', cursor });
  assert({
    given: 'a waiting-longest URL with a keyset cursor',
    should: 'carry the sort to the backend and subsequent page URLs',
    actual: parsed.success
      ? [
          parsed.data.sort,
          lobbyHref(parsed.data, cursor),
          lobbyHref(parsed.data),
        ]
      : null,
    expected: [
      'longest-waiting',
      `/lobby?sort=longest-waiting&cursor=${cursor}`,
      '/lobby?sort=longest-waiting',
    ],
  });
});
