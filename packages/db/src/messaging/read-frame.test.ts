import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { channelReadFrame } from './read-frame';
setupRitewayBun();
const channelId = 'c'.repeat(24),
  actorId = 'a'.repeat(24);
const counters = { channelId, messageSequence: 3, changeVersion: 8 };
const row = (sequence: number, changeVersion: number) => [
  'm'.repeat(23) + sequence,
  channelId,
  actorId,
  sequence,
  changeVersion,
  'Owned text',
  null,
  new Date('2026-10-09T18:00:00Z'),
  null,
  null,
];

test('protected history and changes preserve bounded pagination and authority-only cursor advancement', async () => {
  const { client, queries } = fakeSql([
    [row(3, 4), row(2, 3), row(1, 2)],
    [row(2, 6), row(3, 7)],
    [row(3, 7)],
    [[3]],
  ]);
  let authorizations = 0;
  const frame = channelReadFrame(
    drizzle({ client }),
    { channelId, actorId },
    counters,
    async () => {
      authorizations += 1;
    },
  );
  const history = await frame.history({ limit: 2, before: 4, query: 'TEXT' });
  const truncated = await frame.changes({ limit: 1, after: 4 });
  const final = await frame.changes({ limit: 2, after: 6 });
  const marked = await frame.markRead(2);
  assert({
    given:
      'bounded history, a full changes page and an authority-only final advance',
    should:
      'keep chronological cursors within the selected channel and advance final changes to current authority',
    actual: [
      history.messages.map((message) => message.sequence),
      history.nextBefore,
      truncated.nextAfter,
      final.nextAfter,
      marked,
      authorizations,
    ],
    expected: [
      [3, 2],
      { channelId, sequence: 2 },
      { channelId, changeVersion: 6 },
      { channelId, changeVersion: 8 },
      3,
      4,
    ],
  });
  assert({
    given: 'search and read-marker adapter queries',
    should:
      'scope reads by channel and update read progress monotonically without notification preferences',
    actual: [
      queries[0]?.query.includes('strpos(lower('),
      queries[0]?.params.includes(channelId),
      queries[3]?.query.includes('greatest('),
      queries[3]?.query
        .split('do update set')[1]
        ?.includes('notification_level'),
    ],
    expected: [true, true, true, false],
  });
});
test('each channel read refuses fresh authority loss before driver access', async () => {
  const { client, queries } = fakeSql([]);
  const frame = channelReadFrame(
    drizzle({ client }),
    { channelId, actorId },
    counters,
    async () => {
      throw createAppError('AUTHORIZATION');
    },
  );
  for (const operation of [
    () => frame.history({ limit: 2 }),
    () => frame.changes({ limit: 2, after: 0 }),
    () => frame.markRead(1),
  ])
    await assertRejects({
      given: 'revoked reading authority',
      should: 'deny every protected read and marker operation',
      actual: operation,
      code: 'AUTHORIZATION',
    });
  assert({
    given: 'all three refusals',
    should: 'perform no driver reads or writes',
    actual: queries.length,
    expected: 0,
  });
});
test('malformed cursor and page inputs refuse before driver access, and absent marker return stays unavailable', async () => {
  const { client, queries } = fakeSql([]);
  const frame = channelReadFrame(
    drizzle({ client }),
    { channelId, actorId },
    counters,
    async () => {},
  );
  const invalid = [
    () => frame.history({ limit: 0 }),
    () => frame.history({ limit: 65536 }),
    () => frame.history({ limit: 1, before: -1 }),
    () => frame.history({ limit: 1, query: ' ' }),
    () => frame.changes({ limit: 1, after: 9 }),
    () => frame.changes({ limit: 1, after: 0.5 }),
    () => frame.markRead(4),
  ];
  for (const operation of invalid)
    await assertRejects({
      given: 'an invalid page, search, or future cursor',
      should: 'refuse without reading or marking state',
      actual: operation,
      code: 'VALIDATION',
    });
  assert({
    given: 'invalid inputs',
    should: 'leave the driver untouched',
    actual: queries.length,
    expected: 0,
  });
  await assertRejects({
    given: 'a marker write returning no row',
    should: 'report infrastructure rather than fabricate progress',
    actual: () => frame.markRead(1),
    code: 'INFRASTRUCTURE',
  });
});
