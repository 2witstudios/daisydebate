import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { refundIdempotencyKey } from '@daisy/protocol/billing';
import { withBillingRefunds } from './billing-refunds.test-support';

requireTestServices(process.env);
setupRitewayBun();

test('concurrent cleanup admits one original-charge refund action whose key survives rotating jobs', async () =>
  withBillingRefunds(async ({ fixture, userId, refunds, payment }) => {
    const results = await Promise.all([
      refunds.admit(userId, payment),
      refunds.admit(userId, payment),
    ]);
    const admitted = results[0]!;
    if (!('action' in admitted)) throw Error('Fixture refund refused');
    const action = admitted.action;
    const [count] =
      await fixture.sql`select count(*)::int as n from billing_refund_actions where user_id=${userId}`;
    assert({
      given: 'two cleanup jobs admit the same verified post-closure charge',
      should: 'reuse one immutable original action',
      actual: [
        results.map((r) => r.kind).sort(),
        results.map((r) => ('action' in r ? r.action.id : null)),
        count!.n,
      ],
      expected: [['admitted', 'existing'], [action.id, action.id], 1],
    });
    const claims = await Promise.all([
      refunds.claim(action.id),
      refunds.claim(action.id),
    ]);
    const claimed = claims.find((r) => r?.work === 'create');
    if (!claimed?.action.claim) throw Error('Missing current refund claim');
    assert({
      given: 'independent workers race first refund dispatch',
      should: 'grant one current create claim',
      actual: claims.map((r) => r?.work).sort(),
      expected: ['create', 'wait'],
    });
    await refunds.record(action.id, {
      kind: 'observe',
      claimId: claimed.action.claim.id,
      refundId: `re_${createId()}`,
      status: 'succeeded',
    });
    const [before] =
      await fixture.sql`select id from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
    await fixture.sql`update privacy_jobs set id=${createId()},status='pending',succeeded_at=null where subject_ref=${userId} and vendor='stripe'`;
    const retry = await refunds.admit(userId, payment);
    if (!('action' in retry)) throw Error('Existing action lost');
    const [after] =
      await fixture.sql`select id from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
    assert({
      given: 'the privacy job identity rotates after a known refund',
      should:
        'retain the original financial action, key, amount and period without a new refund',
      actual: [
        before!.id !== after!.id,
        retry.kind,
        retry.action.id,
        refundIdempotencyKey(retry.action),
        retry.action.period,
        retry.action.amountMinor,
        (await refunds.claim(action.id))?.work,
      ],
      expected: [
        true,
        'existing',
        action.id,
        refundIdempotencyKey(action),
        payment.period,
        1000,
        'retrieve',
      ],
    });
  }));
