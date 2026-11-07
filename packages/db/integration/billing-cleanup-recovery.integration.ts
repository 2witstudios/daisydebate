import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import {
  advanceCleanup,
  cleanupWork,
  startCleanup,
} from '@daisy/protocol/billing';
import { finishedOrBlockedBehind } from '../src/testing';
import { loseTransactionCommitReply } from './bounded-transaction.test-support';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
requireTestServices(process.env);
setupRitewayBun();

test('cleanup samples current claim time after a real canonical account lock wait', async () =>
  withClosedPurchase(false, async ({ fixture, subject, jobId, cleanup }) => {
    const [row] =
      await fixture.sql`select retry_at,clock_timestamp() as at from privacy_jobs where id=${jobId}`;
    const initial = startCleanup(jobId, row!.retry_at.toISOString());
    if (!initial) throw Error('Invalid initial fixture');
    const transition = advanceCleanup(
      initial,
      { kind: 'claim', claimId: createId() },
      { now: row!.at.toISOString(), jobId, closed: true },
    );
    if (
      transition.kind !== 'claimed' ||
      transition.state.kind === 'acknowledged' ||
      !transition.state.claim
    )
      throw Error('Missing initial fixture claim');
    const claimId = transition.state.claim.id;
    transition.state.claim.expiresAt = new Date(
      Date.parse(transition.state.claim.claimedAt) + 700,
    ).toISOString();
    await fixture.sql`update privacy_jobs set billing_cleanup=${JSON.stringify(transition.state)}::text::jsonb where id=${jobId}`;
    const [before] =
      await fixture.sql`select attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
    const holder = await fixture.sql.reserve();
    let observed: Promise<unknown> | undefined;
    try {
      await holder`begin`;
      await holder`select id from users where id=${subject.userId} for update`;
      const [backend] = await holder`select pg_backend_pid() as pid`;
      const result = cleanup.record(jobId, {
        kind: 'page',
        claimId,
        work: cleanupWork(transition.state)!,
        ids: [],
        more: false,
      });
      observed = Promise.allSettled([result]);
      const ordering = await finishedOrBlockedBehind(
        result,
        fixture.sql,
        Number(backend!.pid),
        { now: performance.now, deadlineMs: 300 },
      );
      const [edge] =
        await holder`select clock_timestamp()<(billing_cleanup->'claim'->>'expiresAt')::timestamptz as before from privacy_jobs where id=${jobId}`;
      assert({
        given:
          'cleanup completion waiting on canonical closed account authority',
        should: 'be blocked while its current claim is live',
        actual: [ordering, edge!.before],
        expected: ['blocked', true],
      });
      await holder`select pg_sleep(greatest(0,extract(epoch from (billing_cleanup->'claim'->>'expiresAt')::timestamptz-clock_timestamp()))+0.01) from privacy_jobs where id=${jobId}`;
      await holder`commit`;
      const [after] =
        await fixture.sql`select attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
      assert({
        given: 'claim expires during the actual lock wait',
        should: 'return idle without progress, retry or claim refresh',
        actual: [await result, after],
        expected: ['idle', before],
      });
    } finally {
      await holder`rollback`;
      holder.release();
      await observed;
    }
  }));

test('racing cleanup claimers and lost progress commit reply preserve one durable frame', async () =>
  withClosedPurchase(false, async ({ fixture, pool, jobId, cleanup }) => {
    const claims = await Promise.all([
      cleanup.claim(jobId),
      cleanup.claim(jobId),
    ]);
    const c = claims.find((c) => c.kind === 'claimed');
    if (
      !c ||
      c.kind !== 'claimed' ||
      c.state.kind === 'acknowledged' ||
      !c.state.claim
    )
      throw Error('Missing winner');
    assert({
      given: 'two independent runtime operation calls for one due Stripe job',
      should: 'admit one current claim',
      actual: claims.map((c) => c.kind).sort(),
      expected: ['claimed', 'idle'],
    });
    const event = {
      kind: 'page' as const,
      claimId: c.state.claim.id,
      work: c.work,
      ids: [],
      more: false,
    };
    const restore = loseTransactionCommitReply(pool, 2);
    try {
      await assertRejects({
        given: 'progress commits but database reply is lost',
        should: 'report uncertainty rather than invent another result',
        code: 'INFRASTRUCTURE',
        actual: () => cleanup.record(jobId, event),
      });
    } finally {
      restore();
    }
    const [committed] =
      await fixture.sql`select attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
    const replay = await cleanup.record(jobId, event);
    const [after] =
      await fixture.sql`select attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
    assert({
      given: 'replay after a committed progress reply was lost',
      should:
        'retain exactly one consumed claim and durable next lane without retry churn',
      actual: [
        committed!.billing_cleanup.turn,
        committed!.billing_cleanup.claim,
        replay,
        after,
      ],
      expected: ['subscriptions', null, 'idle', committed],
    });
  }));
