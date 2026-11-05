import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { withBoundedRound } from './bounded-transaction.test-support';
import {
  admissionSponsor,
  testBotAdmission,
} from './bot-admission.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('bot admission evaluates entitlement time after a blocked grant read', async () => {
  await withBoundedRound(async (fixture, run, roundId) => {
    const actorId = await admissionSponsor(fixture, [roundId]);
    const [{ user_id: userId }] =
      await fixture.sql`select user_id from actors where id=${actorId}`;
    await fixture.sql`delete from account_entitlement_grants where user_id=${userId}`;
    await fixture.sql`insert into account_entitlement_grants(user_id,entitlement,source,starts_at,expires_at)
      values(${userId},'ai_rounds','subscription',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '600 milliseconds')`;
    const blocker = await fixture.sql.reserve();
    let result: Promise<unknown> | undefined;
    try {
      await blocker`begin`;
      await blocker`lock table account_entitlement_grants in access exclusive mode`;
      const [{ pid }] = await blocker`select pg_backend_pid() as pid`;
      result = testBotAdmission(run).reserve({ actorId, roundId });
      // Attach immediately, including when a broken implementation admits.
      const observed = Promise.allSettled([result]);
      let waiting = false;
      for (let attempt = 0; attempt < 200 && !waiting; attempt++) {
        const [row] =
          await fixture.sql`select exists(select 1 from pg_stat_activity
          where datname=current_database() and ${pid}=any(pg_blocking_pids(pid))
          and query like '%account_entitlement_grants%') as waiting`;
        waiting = row.waiting;
        if (!waiting) await Bun.sleep(5);
      }
      const [edge] = await blocker`select clock_timestamp()<expires_at as before
        from account_entitlement_grants where user_id=${userId}`;
      assert({
        given: 'a paid bot admission waiting on its actual grant query',
        should: 'reach the read while the unchanged grant is still valid',
        actual: [waiting, edge.before],
        expected: [true, true],
      });
      await blocker`select pg_sleep(greatest(0,extract(epoch from expires_at-clock_timestamp()))+0.01)
        from account_entitlement_grants where user_id=${userId}`;
      await blocker`commit`;
      await observed;
      await assertRejects({
        given: 'the grant expires during that read wait without a worker write',
        should: 'refuse from fresh database time instead of the pre-wait time',
        actual: () => result!,
        code: 'CONFLICT',
      });
      assert({
        given: 'the expired admission',
        should: 'leave no usage reservation',
        actual: await fixture.count('usage_reservations', 'actor_id', actorId),
        expected: 0,
      });
    } finally {
      await blocker`rollback`;
      blocker.release();
      await result?.catch(() => undefined);
    }
  });
});
