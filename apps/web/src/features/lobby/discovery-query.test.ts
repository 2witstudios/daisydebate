import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { standingLobbyLabels } from './standing-lobby-labels';
import {
  filterCount,
  isFiltered,
  lobbyHref,
  lobbyModeChoices,
  lobbyStatusChoices,
  parseRoomDiscoveryQuery,
} from './discovery-query';
setupRitewayBun();

const cursor = 'a'.repeat(24);

test('official lobby choices with the same name have distinct labels', () => {
  assert({
    given: 'two official leagues with an Open lobby and one Youth lobby',
    should:
      'qualify only the matching labels and preserve the lobby identities',
    actual: standingLobbyLabels([
      { id: '1', name: 'Open', handle: 'daisy' },
      { id: '2', name: 'Open', handle: 'valley-open' },
      { id: '3', name: 'Youth', handle: 'daisy-youth' },
    ]).map(({ id, name }) => [id, name]),
    expected: [
      ['1', 'Open (daisy)'],
      ['2', 'Open (valley-open)'],
      ['3', 'Youth'],
    ],
  });
});

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

test('the lobby switch names the Open or Youth lobby in the URL (ADR 0162)', () => {
  const parsed = (raw: Record<string, string | string[]>) => {
    const result = parseRoomDiscoveryQuery(raw);
    return result.success ? result.data : null;
  };
  assert({
    given:
      'the Youth and Open lobbies, no lobby, and an unknown or repeated value',
    should:
      'carry the lobby, leave it to the viewer when absent, and refuse the rest',
    actual: [
      parsed({ lobby: 'y'.repeat(24) }),
      parsed({ lobby: 'o'.repeat(24), mode: 'ranked' }),
      parsed({}),
      parsed({ lobby: 'adult' }),
      parsed({ lobby: ['o'.repeat(24), 'y'.repeat(24)] }),
    ],
    expected: [
      { q: '', pageSize: 20, lobbyId: 'y'.repeat(24) },
      { q: '', pageSize: 20, mode: 'ranked', lobbyId: 'o'.repeat(24) },
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
        'offer every status, then each listing status; any, then each competition type',
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

  test('the lobby follows the mode', () => {
    assert({
      given: 'a ranked query in the Youth lobby',
      should: 'carry the lobby after the mode',
      actual: lobbyHref({ ...query, lobbyId: 'y'.repeat(24) }),
      expected: `/lobby?q=tax&pageSize=5&status=open&mode=ranked&lobby=${'y'.repeat(24)}`,
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

  test('the badge counts each panel filter', () => {
    assert({
      given: 'a mode in a lobby, a lobby alone, and a status tab',
      should: 'count the mode only: the lobby is no filter',
      actual: [
        filterCount({
          q: '',
          pageSize: 20,
          mode: 'ranked',
          lobbyId: 'o'.repeat(24),
        }),
        filterCount({ q: '', pageSize: 20, lobbyId: 'y'.repeat(24) }),
        filterCount({ q: '', pageSize: 20, status: 'live' }),
      ],
      expected: [1, 0, 0],
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

test('Newest is the Lobby’s default order, so its URL never names it', () => {
  const parsed = parseRoomDiscoveryQuery({ sort: 'newest' });
  assert({
    given: 'the sort select submitting Newest, then an unknown order',
    should: 'read Newest as no sort, and refuse the unknown one',
    actual: [
      parsed.success ? [parsed.data.sort, lobbyHref(parsed.data)] : null,
      parseRoomDiscoveryQuery({ sort: 'closest-to-full' }).success,
    ],
    expected: [[undefined, '/lobby'], false],
  });
});
