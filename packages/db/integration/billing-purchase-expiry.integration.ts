import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { finishedOrBlockedBehind } from '../src/testing';
import { offer, withBillingPurchases } from './billing-purchases.test-support';

requireTestServices(process.env);
setupRitewayBun();

test('a creation cutoff crossed during the account lock wait abandons only the proven undispatched intent', async () =>
  withBillingPurchases(async ({ fixture, purchases, subject }) => {
    const id = createId();
    await fixture.sql`insert into billing_purchases(id,user_id,mode,price_id,return_origin,admitted_at,state)
      values(${id},${subject.userId},'test',${offer.priceId},${offer.returnOrigin},date_trunc('milliseconds',clock_timestamp())-interval '5 minutes'+interval '700 milliseconds','{"kind":"admitted"}'::jsonb)`;
    const holder = await fixture.sql.reserve();
    let result: ReturnType<typeof purchases.recover> | undefined;
    let observed: Promise<unknown> | undefined;
    try {
      await holder`begin`;
      await holder`select id from users where id=${subject.userId} for update`;
      const [backend] = await holder`select pg_backend_pid() as pid`;
      result = purchases.recover(subject, id);
      observed = Promise.allSettled([result]);
      const ordering = await finishedOrBlockedBehind(
        result,
        fixture.sql,
        Number(backend!.pid),
        { now: performance.now, deadlineMs: 300 },
      );
      const [edge] =
        await holder`select clock_timestamp()<admitted_at+interval '5 minutes' as before from billing_purchases where id=${id}`;
      assert({
        given: 'recovery waiting on the canonical account lock',
        should: 'wait before its immutable creation cutoff',
        actual: [ordering, edge!.before],
        expected: ['blocked', true],
      });
      await holder`select pg_sleep(greatest(0,extract(epoch from admitted_at+interval '5 minutes'-clock_timestamp()))+0.01) from billing_purchases where id=${id}`;
      await holder`commit`;
      const recovered = await result;
      assert({
        given: 'a cutoff crossed during the actual lock wait',
        should:
          'allow no creation claim and permanently abandon the never-dispatched identity',
        actual: [
          recovered.work,
          recovered.claimId,
          recovered.purchase.state.kind,
          (await purchases.recover(subject, id)).work,
        ],
        expected: ['none', null, 'abandoned', 'none'],
      });
    } finally {
      await holder`rollback`;
      holder.release();
      await observed;
    }
  }));

test('a possible creation claim expiring during a lock wait rejects stale unknown and preserves evidence for recovery', async () =>
  withBillingPurchases(async ({ fixture, purchases, subject }) => {
    const id = createId();
    const claimId = createId();
    await fixture.sql`insert into billing_purchases(id,user_id,mode,price_id,return_origin,admitted_at,state)
      select ${id},${subject.userId},'test',${offer.priceId},${offer.returnOrigin},now,
        jsonb_build_object('kind','creating','startedAt',to_char(now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'claim',jsonb_build_object('id',${claimId}::text,'claimedAt',to_char(now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'expiresAt',to_char((now+interval '700 milliseconds') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
      from (select date_trunc('milliseconds',clock_timestamp()) as now) as clock`;
    const before = (await purchases.read(subject, id)).state;
    const holder = await fixture.sql.reserve();
    let result: ReturnType<typeof purchases.record> | undefined;
    let observed: Promise<unknown> | undefined;
    try {
      await holder`begin`;
      await holder`select id from users where id=${subject.userId} for update`;
      const [backend] = await holder`select pg_backend_pid() as pid`;
      result = purchases.record(subject, id, { kind: 'unknown', claimId });
      observed = Promise.allSettled([result]);
      const ordering = await finishedOrBlockedBehind(
        result,
        fixture.sql,
        Number(backend!.pid),
        { now: performance.now, deadlineMs: 300 },
      );
      const [edge] =
        await holder`select clock_timestamp()<(state->'claim'->>'expiresAt')::timestamptz as before from billing_purchases where id=${id}`;
      assert({
        given: 'a claimed operation waiting on current account authority',
        should: 'wait while its claim remains live',
        actual: [ordering, edge!.before],
        expected: ['blocked', true],
      });
      await holder`select pg_sleep(greatest(0,extract(epoch from (state->'claim'->>'expiresAt')::timestamptz-clock_timestamp()))+0.01) from billing_purchases where id=${id}`;
      await holder`commit`;
      assert({
        given: 'expiry during the wait',
        should: 'refuse without replacing possible-execution evidence',
        actual: [await result, (await purchases.read(subject, id)).state],
        expected: ['refuse', before],
      });
      const recovered = await purchases.recover(subject, id);
      assert({
        given: 'same-intent recovery before original creation cutoff',
        should:
          'issue a fresh claim and keep the first possible execution instant',
        actual: [
          recovered.work,
          recovered.claimId !== claimId,
          'startedAt' in recovered.purchase.state &&
            'startedAt' in before &&
            recovered.purchase.state.startedAt === before.startedAt,
          await purchases.record(subject, id, { kind: 'unknown', claimId }),
        ],
        expected: ['create', true, true, 'refuse'],
      });
    } finally {
      await holder`rollback`;
      holder.release();
      await observed;
    }
  }));

test('bounded discovery cursor survives restart and empty scans never release an uncertain attempt', async () =>
  withBillingPurchases(async ({ fixture, purchases, subject }) => {
    const id = createId();
    await fixture.sql`insert into billing_purchases(id,user_id,mode,price_id,return_origin,admitted_at,state)
      select ${id},${subject.userId},'test',${offer.priceId},${offer.returnOrigin},now,
        jsonb_build_object('kind','unknown','startedAt',to_char(now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'retryAt',to_char(now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'afterSessionId',null)
      from (select date_trunc('milliseconds',clock_timestamp())-interval '2 days' as now) as clock`;
    const afterSessionId = `cs_test_${createId()}`;
    const first = await purchases.record(subject, id, {
      kind: 'searched',
      beforeSessionId: null,
      afterSessionId,
    });
    const current = await purchases.read(subject, id);
    const stale = await purchases.record(subject, id, {
      kind: 'searched',
      beforeSessionId: null,
      afterSessionId: null,
    });
    assert({
      given:
        'an unresolved attempt beyond vendor idempotency retention and a stale scan',
      should:
        'persist progress and reject stale writes without releasing admission',
      actual: [
        first,
        current.state.kind,
        current.state.kind === 'unknown' && current.state.afterSessionId,
        stale,
        (await purchases.read(subject, id)).state,
      ],
      expected: ['changed', 'unknown', afterSessionId, 'refuse', current.state],
    });
  }));
