import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
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
    const previousRound = await fixture.round({ created_by_actor_id: actorId });
    const reservedAt = new Date('2026-01-01T00:00:00.000Z');
    await fixture.insert('usage_reservations', {
      id: createId(),
      actor_id: actorId,
      round_id: previousRound,
      kind: 'ai_round',
      reserved_at: reservedAt,
      source: { kind: 'lifetime' },
      binds_free_judge: true,
      state: { kind: 'unknown', countedAt: reservedAt.toISOString() },
    });
    await fixture.sql`delete from account_entitlement_grants where user_id=${userId}`;
    await fixture.sql`insert into account_entitlement_grants(user_id,entitlement,source,starts_at,expires_at)
      values(${userId},'ai_rounds','subscription',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '600 milliseconds')`;
    const [period] =
      await fixture.sql`select starts_at,expires_at from account_entitlement_grants where user_id=${userId}`;
    const subscriptionId = createId();
    // Fault-controlled verified evidence; this fixture is not a Stripe lifecycle receipt.
    await fixture.sql`insert into billing_subscriptions(id,user_id,vendor_subscription_id,evidence,current,observed_at)
      values(${subscriptionId},${userId},${'sub_' + subscriptionId},${{
        lifecycle: 'active',
        settlement: {
          kind: 'paid',
          invoiceId: 'in_expiry',
          period: {
            subscriptionId,
            startsAt: period.starts_at.toISOString(),
            endsAt: period.expires_at.toISOString(),
          },
        },
      }},true,clock_timestamp())`;
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
        actual: await fixture.count('usage_reservations', 'round_id', roundId),
        expected: 0,
      });
    } finally {
      await blocker`rollback`;
      blocker.release();
      await result?.catch(() => undefined);
      await fixture.sql`delete from billing_subscriptions where id=${subscriptionId}`;
    }
  });
});
