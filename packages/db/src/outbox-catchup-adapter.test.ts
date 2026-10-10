import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readOutboxCatchup } from './outbox-catchup';
setupRitewayBun();
const topic = `room:${'b'.repeat(24)}`;
const through = { txid: '3', seq: 3n };
const persisted = {
  txid: '2',
  seq: '2',
  topic,
  kind: 'room.changed',
  version: 2,
  payload: { kind: 'room.changed', ids: ['b'.repeat(24)], entityVersion: 2 },
  createdAt: '2026-10-09T00:00:00.000Z',
};
const adapter = (records: unknown[], onRead = () => {}) =>
  ({
    execute: async () => {
      onRead();
      return records;
    },
  }) as unknown as Parameters<typeof readOutboxCatchup>[0];
for (const [label, records, limit, resync] of [
  ['intact snapshot', [{ floor: '1:1', rows: [persisted] }], 2, false],
  ['advanced boundary', [{ floor: '2:2', rows: [persisted] }], 2, true],
  ['missing boundary', [{ floor: null, rows: [persisted] }], 2, true],
  ['missing snapshot', [], 2, true],
  [
    'overflow window',
    [{ floor: '1:1', rows: [persisted, persisted] }],
    1,
    true,
  ],
] as const)
  test(`catchup adapter ${label}`, async () => {
    const result = await readOutboxCatchup(
      adapter([...records]),
      topic,
      '1:1',
      through,
      limit,
    );
    assert({
      given: 'a single database snapshot with its deletion watermark',
      should:
        'return ordered bigint cursors only for certified bounded history',
      actual: result,
      expected: { rows: resync ? [] : [{ ...persisted, seq: 2n }], resync },
    });
  });
test('catchup input failures never reach persistence', async () => {
  let calls = 0;
  const database = adapter([], () => {
    calls += 1;
  });
  let denied = 0;
  for (const [requestedTopic, since, end, limit] of [
    ['invalid', '1:1', through, 1],
    [topic, 'invalid', through, 1],
    [topic, '1:1', { txid: '3', seq: -1n }, 1],
    ...[0, 501, 1.5].map((limit) => [topic, '1:1', through, limit] as const),
  ] as const) {
    try {
      await readOutboxCatchup(database, requestedTopic, since, end, limit);
    } catch {
      denied += 1;
    }
  }
  assert({
    given: 'invalid topics, cursor bounds and unbounded requests',
    should: 'refuse all requests before issuing SQL',
    actual: [calls, denied],
    expected: [0, 6],
  });
});
