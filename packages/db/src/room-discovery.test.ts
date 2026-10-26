import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createTestDatabase } from './index.test-support';
import { caller, accountFact } from './room-command-operations.test-support';
setupRitewayBun();
const ids = ['a'.repeat(24), 'b'.repeat(24), 'c'.repeat(24)];
const entry = {
  id: ids[0]!,
  version: 1,
  title: 'Room',
  topic: 'Topic',
  visibility: 'public',
  hostActorId: caller.actorId,
  hostLabel: 'Host',
  status: 'assembling',
  competitionType: 'casual',
  seated: false,
  roundRef: null,
  formatLabel: 'Foundation',
  seatsTaken: 1,
  seatCount: 2,
  waitingSince: '2026-10-09T00:00:00.000Z',
  live: null,
  hostRating: null,
} as const;
test('discovery bounds SQL before Room locks and reads no aggregate', async () => {
  const { database, queries } = discoveryFixture([
    { ...entry, role: null, slot: null },
  ]);
  const page = await database.listRoomPage(
    caller,
    { pageSize: 2, q: '' },
    () => true,
    () => true,
    () => false,
  );
  assert({
    given: 'three candidate IDs and a two row work setting',
    should:
      'return continuation from last returned accessible entry, lock only two IDs, and avoid full aggregate',
    actual: [
      page,
      queries.slice(1).length,
      queries[1]!.query.includes('limit'),
      queries[1]!.query.includes('for share'),
      queries[2]!.params.includes(ids[2]),
      queries.some((q) =>
        /format_revisions|readiness_command_id/.test(q.query),
      ),
    ],
    expected: [
      { rooms: [entry], nextCursor: ids[0], retry: false },
      5,
      true,
      false,
      false,
      false,
    ],
  });
});
test('adapter refuses malformed page before any SQL', async () => {
  const { database, queries } = createTestDatabase([]);
  await assertRejects({
    given: 'an over-bound page',
    should: 'refuse with validation',
    actual: () =>
      database.listRoomPage(
        caller,
        { pageSize: 51, q: '' },
        () => true,
        () => true,
        () => false,
      ),
    code: 'VALIDATION',
  });
  assert({
    given: 'a refused request',
    should: 'perform no SQL',
    actual: queries.length,
    expected: 0,
  });
});

test('lock-wait privacy changes never disclose an inaccessible cursor', async () => {
  for (const rows of [[], [{ ...entry, role: null, slot: null }]]) {
    const { database, queries } = discoveryFixture(rows);
    const page = await database.listRoomPage(
      caller,
      { pageSize: 2, q: '' },
      () => true,
      () => true,
      () => false,
    );
    assert({
      given: 'a private final scanned candidate after a lock wait',
      should:
        'continue only from a returned accessible id or request explicit retry',
      actual: [page.nextCursor, page.retry, queries.length],
      expected: [rows.length ? ids[0] : null, rows.length === 0, 6],
    });
  }
});

test('Lobby filters narrow the candidates and live facts read as ISO instants', async () => {
  const started = {
    ...entry,
    status: 'started' as const,
    competitionType: 'ranked' as const,
    roundRef: { id: ids[1]!, status: 'active' as const },
    waitingSince: null,
    live: { stage: 'live', startedAt: '2026-10-09T00:05:00+00:00' },
    hostRating: 1512,
  };
  const { database, queries } = discoveryFixture([
    { ...started, role: null, slot: null },
  ]);
  const page = await database.listRoomPage(
    caller,
    { pageSize: 2, q: '', status: 'live', mode: 'ranked' },
    () => true,
    () => true,
    () => true,
  );
  assert({
    given:
      'a live ranked filter and a launched Room whose host the viewer may not name',
    should:
      'bind the filters into the candidate SQL, normalize the start instant and hide the host rating with the host',
    actual: [
      queries[1]!.params.includes('ranked'),
      queries[1]!.query.includes('competition_type'),
      page.rooms[0]?.live,
      [page.rooms[0]?.hostLabel, page.rooms[0]?.hostRating],
    ],
    expected: [
      true,
      true,
      { stage: 'live', startedAt: '2026-10-09T00:05:00.000Z' },
      [null, null],
    ],
  });
});

function discoveryFixture(rows: readonly Record<string, unknown>[]) {
  return createTestDatabase([
    [accountFact()],
    ids.map((id) => ({ id })),
    [],
    [],
    [accountFact()],
    rows,
  ]);
}

test('discovery keys oldest and newest pages on immutable creation time and Room id', async () => {
  for (const sort of ['longest-waiting', 'newest'] as const) {
    const { database, queries } = discoveryFixture([
      { ...entry, role: null, slot: null },
    ]);
    await database.listRoomPage(
      caller,
      { pageSize: 2, q: '', sort, cursor: ids[1] },
      () => true,
      () => true,
      () => false,
    );
    assert({
      given: `a ${sort} page after a Room that may have launched`,
      should:
        'seek and order both discovery branches by the same immutable tuple',
      actual: [
        queries[1]!.query.includes('(r.created_at, r.id collate "C")'),
        queries[1]!.query.includes(sort === 'newest' ? '<' : '>'),
        queries[1]!.query.includes(
          'select r.created_at, r.id collate "C" from rooms r',
        ),
        queries[1]!.query.includes('order by created_at'),
        queries[1]!.params.includes(ids[1]),
        queries.at(-1)!.query.includes('order by r.created_at'),
      ],
      expected: [true, true, true, true, true, true],
    });
  }
});
