import { readFileSync } from 'node:fs';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { appendStream, openStream, readStream } from './stream';
setupRitewayBun();
const channelId = 'c'.repeat(24);
const streamRow = (messageSequence: number, changeVersion: number) => [
  { messageSequence, changeVersion },
];

test('appendStream allocates the whole plan on the locked row and writes the counters once', async () => {
  const { client, queries } = fakeSql([streamRow(3, 5), []]);
  const allocation = await appendStream(drizzle({ client }), channelId, {
    messages: 2,
    changes: 3,
  });
  assert({
    given: 'a plan of two messages and one further change',
    should:
      'lock the stream row, return contiguous sequences and versions, and write once',
    actual: [
      allocation,
      queries.map((query) => query.query.trim().split(/\s/)[0]),
      queries[0]?.query.trim().endsWith('for update'),
      queries[1]?.params,
    ],
    expected: [
      {
        messageSequence: 5,
        changeVersion: 8,
        sequences: [4, 5],
        versions: [6, 7, 8],
      },
      ['select', 'update'],
      true,
      [5, 8, channelId],
    ],
  });
});

test('appendStream refuses an overflowing plan before writing', async () => {
  for (const row of [
    streamRow(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    streamRow(0, Number.MAX_SAFE_INTEGER),
  ]) {
    const { client, queries } = fakeSql([row]);
    await assertRejects({
      given: 'a stream whose counters cannot hold the plan',
      should: 'refuse the whole allocation',
      actual: () =>
        appendStream(drizzle({ client }), channelId, {
          messages: 1,
          changes: 1,
        }),
      code: 'CONFLICT',
    });
    assert({
      given: 'the overflow refusal',
      should: 'leave the counters unwritten',
      actual: queries.length,
      expected: 1,
    });
  }
});

test('appendStream refuses a malformed plan before locking', async () => {
  for (const plan of [
    { messages: 0, changes: 0 },
    { messages: 2, changes: 1 },
    { messages: -1, changes: 1 },
    { messages: 0, changes: 1.5 },
  ]) {
    const { client, queries } = fakeSql([]);
    await assertRejects({
      given: `plan ${JSON.stringify(plan)}`,
      should: 'refuse a plan that is empty or breaks changes >= messages',
      actual: () => appendStream(drizzle({ client }), channelId, plan),
      code: 'VALIDATION',
    });
    assert({
      given: 'the malformed plan',
      should: 'touch no row',
      actual: queries.length,
      expected: 0,
    });
  }
});

test('appendStream and readStream refuse a channel without a stream', async () => {
  const { client } = fakeSql([[], []]);
  const database = drizzle({ client });
  await assertRejects({
    given: 'no stream row',
    should: 'refuse the allocation',
    actual: () =>
      appendStream(database, channelId, { messages: 0, changes: 1 }),
    code: 'NOT_FOUND',
  });
  await assertRejects({
    given: 'no stream row',
    should: 'refuse the read',
    actual: () => readStream(database, channelId),
    code: 'NOT_FOUND',
  });
});

test('readStream reads the high-water mark without locking; openStream starts at the creation revision', async () => {
  const { client, queries } = fakeSql([streamRow(2, 4), []]);
  const database = drizzle({ client });
  const stream = await readStream(database, channelId);
  await openStream(database, channelId);
  assert({
    given: 'a reader and a channel creation',
    should: 'read without a row lock and insert sequence 0 at version 1',
    actual: [
      stream,
      queries[0]?.query.includes('for update'),
      queries[1]?.query.includes('values($1, 0, 1)'),
    ],
    expected: [{ messageSequence: 2, changeVersion: 4 }, false, true],
  });
});

/** Production source outside the stream module that names a stream counter write. */
function streamWriters(root: string) {
  const writes = [
    /(?:update|insert\s+into|delete\s+from)\s+"?messaging_channel_streams\b/iu,
    /\.(?:update|insert|delete)\(\s*messagingChannelStreams\b/u,
  ];
  const writers: string[] = [];
  const files = [
    ...new Bun.Glob('apps/*/src/**/*.{ts,tsx}').scanSync(root),
    ...new Bun.Glob('packages/*/src/**/*.{ts,tsx}').scanSync(root),
  ];
  if (!files.includes('packages/db/src/messaging/stream.ts'))
    throw new Error('Writer scan did not reach the stream module');
  for (const file of files) {
    if (
      /\.test(?:-support)?\.tsx?$|\/test-fixture\.ts$/u.test(file) ||
      file === 'packages/db/src/messaging/stream.ts'
    )
      continue;
    const source = readFileSync(`${root}/${file}`, 'utf8');
    if (writes.some((pattern) => pattern.test(source))) writers.push(file);
  }
  return writers.sort();
}

test('only stream.ts writes the channel stream counters (MSG-2.2-arch1)', () => {
  const root = new URL('../../../../', import.meta.url).pathname;
  assert({
    given: 'every production module in the repository',
    should: 'leave appendStream and openStream the only stream writers',
    actual: streamWriters(root),
    expected: [],
  });
});
