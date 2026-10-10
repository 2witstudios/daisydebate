import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roomListQuerySchema, roomListPageSchema } from './room-contract';
setupRitewayBun();
test('Lobby work bounds and cursor grammar refuse malformed input', () => {
  assert({
    given: 'untrusted cursors, sizes and unknown history mode',
    should: 'refuse rather than clamp or accept compatibility fields',
    actual: [
      { cursor: '' },
      { cursor: 'not-an-id' },
      { pageSize: 0 },
      { pageSize: 51 },
      { pageSize: 1.5 },
      { pageSize: '2' },
      { history: true },
      { q: 'x'.repeat(101) },
    ].map((value) => roomListQuerySchema.safeParse(value).success),
    expected: Array(8).fill(false),
  });
  assert({
    given: 'an omitted resource-work setting',
    should: 'apply the provisional 20 row page default',
    actual: roomListQuerySchema.parse({}),
    expected: { pageSize: 20, q: '' },
  });
  assert({
    given: 'an explicit empty active page',
    should: 'require an explicit end cursor',
    actual: [
      roomListPageSchema.safeParse({
        rooms: [],
        nextCursor: null,
        retry: false,
      }).success,
      roomListPageSchema.safeParse({ rooms: [] }).success,
    ],
    expected: [true, false],
  });
});
