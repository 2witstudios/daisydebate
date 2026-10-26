import { assert, setupRitewayBun, test } from 'riteway/bun';
import { parseRoomDiscoveryQuery } from './discovery-query';
setupRitewayBun();
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
