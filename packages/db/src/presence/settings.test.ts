import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { readPresenceHidden, writePresenceHidden } from './settings';
import { ownReader } from '../own-collection.test-support';
setupRitewayBun();

const me = 'a'.repeat(24),
  userId = 'u'.repeat(24);
const account = ownReader(me, userId);

test('presence visibility reads and writes only behind the reader’s fence', async () => {
  const { client, queries } = fakeSql([[account], [[true]], [account], []]);
  const fenced: string[] = [];
  const fence = async () => {
    fenced.push('fenced');
  };
  const hidden = await readPresenceHidden(
    drizzle({ client }),
    { userId, actorId: me },
    fence,
  );
  const written = await writePresenceHidden(
    drizzle({ client }),
    { userId, actorId: me },
    { hidden: false, now: '2026-10-26T18:00:00.000Z' },
    fence,
  );
  assert({
    given: 'a stored hidden choice, then a choice to show',
    should: 'read it and upsert the new one, each after the fence',
    actual: [
      hidden,
      written,
      fenced,
      queries.at(-1)?.query.includes('on conflict'),
    ],
    expected: [true, false, ['fenced', 'fenced'], true],
  });
});

test('a member with no stored choice is visible', async () => {
  const { client } = fakeSql([[account], []]);
  assert({
    given: 'no presence settings row',
    should: 'read the member as not hidden',
    actual: await readPresenceHidden(
      drizzle({ client }),
      { userId, actorId: me },
      async () => {},
    ),
    expected: false,
  });
  await assertRejects({
    given: 'a malformed actor id',
    should: 'refuse the write before any query',
    actual: () =>
      writePresenceHidden(
        drizzle({ client }),
        { userId, actorId: 'x' },
        { hidden: true, now: '2026-10-26T18:00:00.000Z' },
        async () => {},
      ),
    code: 'VALIDATION',
  });
});
