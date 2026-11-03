import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fakeSql } from '../index.test-support';
import { challengeContactReactions } from './frame';

setupRitewayBun();

test('a block ends the pair’s challenges through Challenges’ own reaction', async () => {
  const pair = { lowActorId: 'a'.repeat(24), highActorId: 'b'.repeat(24) };
  const run = async (blocked: boolean) => {
    const { client, queries } = fakeSql([[]]);
    await challengeContactReactions.onBlock(drizzle({ client }), pair, blocked);
    return queries.map(
      (query) => query.query.match(/delete from "?([a-z_]+)/)?.[1],
    );
  };
  assert({
    given: 'a block and then an unblock',
    should: 'delete the pair’s challenges only on the block',
    actual: [await run(true), await run(false)],
    expected: [['challenges'], []],
  });
});
