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
  length: 'full',
  seated: false,
  roundRef: null,
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
  );
  assert({
    given: 'three candidate IDs and a two row work setting',
    should:
      'return continuation from last returned accessible entry, lock only two IDs, and avoid full aggregate',
    actual: [
      page,
      queries.slice(2).length,
      queries[2]!.query.includes('limit'),
      queries[2]!.query.includes('for share'),
      queries[3]!.params.includes(ids[2]),
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
    );
    assert({
      given: 'a private final scanned candidate after a lock wait',
      should:
        'continue only from a returned accessible id or request explicit retry',
      actual: [page.nextCursor, page.retry, queries.length],
      expected: [rows.length ? ids[0] : null, rows.length === 0, 7],
    });
  }
});

function discoveryFixture(rows: readonly Record<string, unknown>[]) {
  return createTestDatabase([
    [accountFact()],
    [accountFact()],
    ids.map((id) => ({ id })),
    [],
    [],
    [accountFact()],
    rows,
  ]);
}
