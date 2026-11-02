import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { readChosenStatus, writeChosenStatus } from './settings';
import { ownReader } from '../own-collection.test-support';
setupRitewayBun();

const me = 'a'.repeat(24),
  userId = 'u'.repeat(24);
const account = ownReader(me, userId);

test('presence visibility reads and writes only behind the reader’s fence', async () => {
  const { client, queries } = fakeSql([
    [account],
    [['busy']],
    [account],
    [],
    [{ txid: '1', seq: '1' }],
  ]);
  const fenced: string[] = [];
  const fence = async () => {
    fenced.push('fenced');
  };
  const hidden = await readChosenStatus(
    drizzle({ client }),
    { userId, actorId: me },
    fence,
  );
  const written = await writeChosenStatus(
    drizzle({ client }),
    { userId, actorId: me },
    { status: 'online', now: '2026-10-26T18:00:00.000Z' },
    fence,
  );
  assert({
    given: 'a stored choice, then a new one',
    should: 'read it and upsert the new one, each after the fence',
    actual: [
      hidden,
      written,
      fenced,
      queries.some((query) => query.query.includes('on conflict')),
    ],
    expected: ['busy', 'online', ['fenced', 'fenced'], true],
  });
});

test('a member with no stored choice is visible', async () => {
  const { client } = fakeSql([[account], []]);
  assert({
    given: 'no presence settings row',
    should: 'read the member as online',
    actual: await readChosenStatus(
      drizzle({ client }),
      { userId, actorId: me },
      async () => {},
    ),
    expected: 'online',
  });
  await assertRejects({
    given: 'a malformed actor id',
    should: 'refuse the write before any query',
    actual: () =>
      writeChosenStatus(
        drizzle({ client }),
        { userId, actorId: 'x' },
        { status: 'busy', now: '2026-10-26T18:00:00.000Z' },
        async () => {},
      ),
    code: 'VALIDATION',
  });
});
