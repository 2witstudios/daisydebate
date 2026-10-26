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

test('search trims edges before applying its bound', () => {
  assert({
    given: 'padded and whitespace-only searches',
    should: 'normalize surrounding whitespace',
    actual: [' Room ', ' \t\n '].map((q) => roomListQuerySchema.parse({ q }).q),
    expected: ['Room', ''],
  });
  assert({
    given: '100 search characters padded with spaces',
    should: 'enforce the normalized length',
    actual: roomListQuerySchema.safeParse({ q: ` ${'x'.repeat(100)} ` })
      .success,
    expected: true,
  });
  assert({
    given: 'unknown API keys or repeated recognized keys',
    should: 'keep the API contract strict',
    actual: [
      { utm_source: 'a' },
      { next: '/lobby' },
      { q: ['a', 'b'] },
      { cursor: ['a', 'b'] },
      { pageSize: [1, 2] },
    ].map((value) => roomListQuerySchema.safeParse(value).success),
    expected: Array(5).fill(false),
  });
});

test('Lobby filters and discovery facts are a closed grammar', () => {
  assert({
    given: 'status and mode filters, then unknown or legacy values',
    should: 'accept open, starting or live and ranked or casual only',
    actual: [
      roomListQuerySchema.safeParse({ status: 'live', mode: 'ranked' }).success,
      roomListQuerySchema.safeParse({ status: 'all' }).success,
      roomListQuerySchema.safeParse({ mode: 'any' }).success,
      roomListQuerySchema.safeParse({ length: 'quick' }).success,
    ],
    expected: [true, false, false, false],
  });
  const entry = {
    id: 'a'.repeat(24),
    version: 1,
    title: 'Room',
    topic: 'Topic',
    visibility: 'public',
    hostActorId: 'b'.repeat(24),
    hostLabel: 'Host',
    status: 'started',
    competitionType: 'ranked',
    seated: false,
    roundRef: { id: 'c'.repeat(24), status: 'active' },
    formatLabel: 'Foundation',
    seatsTaken: 3,
    seatCount: 3,
    waitingSince: null,
    live: { stage: 'live', startedAt: '2026-10-09T00:00:00.000Z' },
    hostRating: 1512,
  };
  const page = (rooms: readonly unknown[]) =>
    roomListPageSchema.safeParse({ rooms, nextCursor: null, retry: false })
      .success;
  assert({
    given:
      'a live ranked entry, then one missing seat counts, with a fractional rating, or with a zero seat count',
    should: 'accept only the complete integral projection',
    actual: [
      page([entry]),
      page([{ ...entry, seatsTaken: undefined }]),
      page([{ ...entry, hostRating: 1512.4 }]),
      page([{ ...entry, seatCount: 0 }]),
    ],
    expected: [true, false, false, false],
  });
});
