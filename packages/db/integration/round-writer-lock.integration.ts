import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { withFixture, sqlStateOf } from './constraint-helpers';
import { lockedRoundVersion } from '../src/round-projection-writer';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('canonical Round writer permits durable FK admission while serializing writers and erasure', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const roundId = await fixture.round();
    const actorId = await fixture.actor();
    const client = new SQL(databaseUrl, { max: 2 });
    const holder = await client.reserve();
    const contender = await client.reserve();
    try {
      await holder`begin`;
      await lockedRoundVersion(drizzle({ client: holder }), roundId);
      await contender`set lock_timeout='250ms'`;
      const attemptId = createId();
      assert({
        given: 'canonical writer already holds Round before check-in admission',
        should: 'commit a visible pending marker through its real scoped FK',
        actual: await sqlStateOf(
          () => contender`insert into round_check_in_attempts(attempt_id,command_id,round_id,payload_digest,actor_id,received_at,backend_pid,backend_started_at)
          select ${attemptId},${createId()},${roundId},${'a'.repeat(64)},${actorId},clock_timestamp(),pid,backend_start from pg_stat_activity where pid=pg_backend_pid()`,
        ),
        expected: 'accepted',
      });
      assert({
        given: 'admitted marker while competitive writer remains open',
        should: 'be durable and visible to a third connection',
        actual: (
          await fixture.sql`select state from round_check_in_attempts where attempt_id=${attemptId}`
        )[0]?.state,
        expected: 'pending',
      });
      assert({
        given: 'another competitive writer',
        should: 'remain excluded by the canonical Round lock',
        actual: await sqlStateOf(
          () =>
            contender`select id from rounds where id=${roundId} for no key update nowait`,
        ),
        expected: '55P03',
      });
      assert({
        given: 'concurrent owning Round erasure',
        should: 'wait for the active writer rather than bypass it',
        actual: await sqlStateOf(
          () => contender`delete from rounds where id=${roundId}`,
        ),
        expected: '55P03',
      });
    } finally {
      await holder`rollback`;
      holder.release();
      contender.release();
      await client.close();
      await fixture.sql`delete from rounds where id=${roundId}`;
    }
  });
});
