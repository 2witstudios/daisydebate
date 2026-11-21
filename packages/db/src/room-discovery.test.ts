import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createTestDatabase } from './index.test-support';
import { caller, accountRow } from './room-command-operations.test-support';
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
  ageRule: 'adults',
  lobbyId: 'l'.repeat(24),
  openJudgeSeats: 0,
} as const;
test('discovery bounds SQL before Room locks and reads no aggregate', async () => {
  const { database, queries } = discoveryFixture([
    { ...entry, seatKind: null, side: null, slot: null },
  ]);
  const page = await database.listRoomPage(
    caller,
    { pageSize: 2, q: '', lobbyId: entry.lobbyId },
    () => true,
    () => true,
    () => false,
    () => null,
  );
  assert({
    given: 'three candidate IDs and a two row work setting',
    should:
      'return continuation from last returned accessible entry, lock only two IDs, and avoid full aggregate',
    actual: [
      page,
      queries.slice(1).length,
      queries[2]!.query.includes('limit'),
      queries[2]!.query.includes('for share'),
      queries[3]!.params.includes(ids[2]),
      queries.some((q) =>
        /format_revisions|readiness_command_id/.test(q.query),
      ),
    ],
    expected: [
      { rooms: [entry], nextCursor: ids[0], retry: false },
      7,
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
        { pageSize: 51, q: '', lobbyId: entry.lobbyId },
        () => true,
        () => true,
        () => false,
        () => null,
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
  for (const rows of [
    [],
    [{ ...entry, seatKind: null, side: null, slot: null }],
  ]) {
    const { database, queries } = discoveryFixture(rows);
    const page = await database.listRoomPage(
      caller,
      { pageSize: 2, q: '', lobbyId: entry.lobbyId },
      () => true,
      () => true,
      () => false,
      () => null,
    );
    assert({
      given: 'a private final scanned candidate after a lock wait',
      should:
        'continue only from a returned accessible id or request explicit retry',
      actual: [page.nextCursor, page.retry, queries.length],
      expected: [rows.length ? ids[0] : null, rows.length === 0, 8],
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
  };
  const { database, queries } = discoveryFixture([
    {
      ...started,
      hostRating: 1512,
      ageRule: 'under-18',
      seatKind: null,
      side: null,
      slot: null,
    },
  ]);
  const page = await database.listRoomPage(
    caller,
    {
      pageSize: 2,
      q: '',
      lobbyId: entry.lobbyId,
      status: 'live',
      mode: 'ranked',
    },
    () => true,
    () => true,
    () => true,
    () => null,
  );
  assert({
    given:
      'a live ranked filter and a launched Room whose host the viewer may not name',
    should:
      'bind the filters into the candidate SQL, normalize the start instant and hide the host rating with the host',
    actual: [
      queries[2]!.params.includes('ranked'),
      queries[2]!.query.includes('competition_type'),
      page.rooms[0]?.live,
      [page.rooms[0]?.hostLabel, page.rooms[0]?.hostRating],
      page.rooms[0]?.ageRule,
    ],
    expected: [
      true,
      true,
      { stage: 'live', startedAt: '2026-10-09T00:05:00.000Z' },
      [null, null],
      'under-18',
    ],
  });
});

test('discovery exposes only authorized ranked host pools to the publisher', async () => {
  const ranked = {
    ...entry,
    competitionType: 'ranked',
    selectedLadderId: null,
    seatKind: null,
    side: null,
    slot: null,
  };
  const launched = {
    ...ranked,
    id: ids[1],
    status: 'started',
    roundRef: { id: ids[0], status: 'active' },
    frozenLadderId: ids[0],
    frozenSeasonId: ids[2],
  };
  const { database, queries } = discoveryFixture(
    [ranked, launched, { ...launched, id: ids[2] }],
    [[[ids[0]]], [[ids[2]]]],
  );
  const page = await database.listRoomPage(
    caller,
    { pageSize: 3, q: '', lobbyId: entry.lobbyId },
    () => true,
    () => true,
    ({ id }) => id === ids[2],
    () => null,
  );
  assert({
    given:
      'waiting and launched ranked Rooms sharing a pool, and a hidden judge host',
    should:
      'name the concrete season for both visible hosts and withhold the hidden host pool',
    actual: [
      page.rooms.map(({ hostRatingPool }) => hostRatingPool ?? null),
      queries.length,
    ],
    expected: [
      [
        { lobbyId: entry.lobbyId, ladderId: ids[0], seasonId: ids[2] },
        { lobbyId: entry.lobbyId, ladderId: ids[0], seasonId: ids[2] },
        null,
      ],
      10,
    ],
  });
});

function discoveryFixture(
  rows: readonly Record<string, unknown>[],
  poolRows: unknown[][] = [],
) {
  return createTestDatabase([
    [accountRow()],
    [[entry.lobbyId, 'Open', 'open', 'adults', 'o'.repeat(24)]],
    ids.map((id) => ({ id })),
    [],
    [],
    [accountRow()],
    [], // exact-lobby rating read scope
    rows,
    ...poolRows,
  ]);
}

test('discovery keys oldest and newest pages on immutable creation time and Room id', async () => {
  for (const sort of ['longest-waiting', 'newest'] as const) {
    const { database, queries } = discoveryFixture([
      { ...entry, seatKind: null, side: null, slot: null },
    ]);
    await database.listRoomPage(
      caller,
      { pageSize: 2, q: '', lobbyId: entry.lobbyId, sort, cursor: ids[1] },
      () => true,
      () => true,
      () => false,
      () => null,
    );
    assert({
      given: `a ${sort} page after a Room that may have launched`,
      should:
        'seek and order both discovery branches by the same immutable tuple',
      actual: [
        queries[2]!.query.includes('(r.created_at, r.id collate "C")'),
        queries[2]!.query.includes(sort === 'newest' ? '<' : '>'),
        queries[2]!.query.includes(
          'select r.created_at, r.id collate "C" from rooms r',
        ),
        queries[2]!.query.includes('order by created_at'),
        queries[2]!.params.includes(ids[1]),
        queries.at(-1)!.query.includes('order by r.created_at'),
      ],
      expected: [true, true, true, true, true, true],
    });
  }
});
