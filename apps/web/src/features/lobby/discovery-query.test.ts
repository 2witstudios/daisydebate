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
