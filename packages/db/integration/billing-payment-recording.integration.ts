import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { causeChainMember } from '../src/capacity-refusal';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
requireTestServices(process.env);
setupRitewayBun();

test('a new exact owed payment atomically rotates cleanup once while replay preserves recognition and stale work refuses', async () =>
  withClosedPurchase(
    true,
    async ({ fixture, subject, session, cleanup, jobId, renew }) => {
      const [purchase] =
        await fixture.sql`select id,admitted_at from billing_purchases where user_id=${subject.userId}`;
      const read = {
        mode: 'test',
        customerId: session.customerId,
        invoiceId: `in_${createId()}`,
        invoicePaymentId: `inpay_${createId()}`,
        source: {
          kind: 'purchase',
          purchaseId: purchase!.id,
          priceId: 'price_fixture',
          vendorSubscriptionId: session.subscriptionId,
          admittedAt: purchase!.admitted_at.toISOString(),
        },
        evidence: {
          kind: 'partial',
          facts: {
            status: null,
            paidAtSeconds: null,
            amountPaidMinor: null,
            charge: { kind: 'unresolved' },
            period: null,
          },
        },
      };
      const stale = await cleanup.claim(jobId);
      if (
        stale.kind !== 'claimed' ||
        stale.state.kind === 'acknowledged' ||
        !stale.state.claim
      )
        throw Error('Missing original current claim');
      try {
        const recorded = await cleanup.recordPayment(subject.userId, read);
        const [job] =
          await fixture.sql`select id,status,attempts,billing_cleanup,retry_at from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
        const [observation] =
          await fixture.sql`select * from billing_payment_observations where user_id=${subject.userId}`;
        await fixture.sql`delete from billing_customers where user_id=${subject.userId}`;
        const replay = await cleanup.recordPayment(subject.userId, read);
        const refused = await cleanup.record(jobId, {
          kind: 'page',
          claimId: stale.state.claim.id,
          work: stale.work,
          ids: [],
          more: false,
        });
        const [afterJob] =
          await fixture.sql`select id,status,attempts,billing_cleanup,retry_at from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
        const [afterObservation] =
          await fixture.sql`select * from billing_payment_observations where user_id=${subject.userId}`;
        await renew();
        const fresh = await cleanup.claim(job!.id);
        const absence =
          fresh.kind === 'claimed' &&
          fresh.state.kind !== 'acknowledged' &&
          fresh.state.claim
            ? await cleanup.record(job!.id, {
                kind: 'no-effects',
                claimId: fresh.state.claim.id,
                work: fresh.work,
              })
            : 'missing';
        assert({
          given:
            'one newly observed owned payment after closure, replay after customer deletion and an old in-flight cleanup reply',
          should:
            'retain unknowns and immutable attribution, rotate once, keep replay and recognition unchanged, refuse stale progress and empty-effects relief',
          actual: [
            recorded,
            replay,
            job!.id !== jobId,
            job!.status,
            job!.attempts,
            job!.billing_cleanup,
            afterJob,
            afterObservation,
            refused,
            absence,
          ],
          expected: [
            'recorded',
            'unchanged',
            true,
            'pending',
            0,
            null,
            job,
            observation,
            'idle',
            'idle',
          ],
        });
      } finally {
        await fixture.sql`delete from billing_payment_observations where user_id=${subject.userId}`;
      }
    },
  ));

test('observation and reopened job roll back together if queue rotation fails', async () =>
  withClosedPurchase(
    true,
    async ({ fixture, subject, session, cleanup, jobId }) => {
      const read = {
        mode: 'test',
        customerId: session.customerId,
        invoiceId: `in_${createId()}`,
        invoicePaymentId: `inpay_${createId()}`,
        source: {
          kind: 'unresolved',
          vendorSubscriptionId: null,
          priceId: null,
        },
        evidence: {
          kind: 'partial',
          facts: {
            status: null,
            paidAtSeconds: null,
            amountPaidMinor: null,
            charge: { kind: 'unresolved' },
            period: null,
          },
        },
      };
      await fixture.sql`create function daisy_test_payment_reopen_failure() returns trigger language plpgsql as $$ begin if new.vendor='stripe' and new.id<>old.id then if not exists(select 1 from billing_payment_observations where user_id=new.subject_ref and kind='payment') then raise exception 'fault ran before observed fact' using errcode='22000'; end if; raise exception 'injected reopened job write failure' using errcode='23514',constraint='daisy_test_payment_reopen_failure_after_observation'; end if;return new;end $$`;
      await fixture.sql`create trigger daisy_test_payment_reopen_failure before update on privacy_jobs for each row execute function daisy_test_payment_reopen_failure()`;
      let rejected = false;
      try {
        try {
          await cleanup.recordPayment(subject.userId, read);
        } catch (error) {
          rejected =
            causeChainMember(
              (cause) =>
                Object.getOwnPropertyDescriptor(cause, 'constraint')?.value ===
                'daisy_test_payment_reopen_failure_after_observation',
              error,
            ) !== undefined;
        }
        const [job] =
          await fixture.sql`select id from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
        const rows =
          await fixture.sql`select id from billing_payment_observations where user_id=${subject.userId}`;
        assert({
          given:
            'a failure after the payment write but before the mandatory new job commits',
          should:
            'rollback the observed fact and preserve original queue identity atomically',
          actual: [rejected, rows.length, job!.id],
          expected: [true, 0, jobId],
        });
      } finally {
        await fixture.sql`drop trigger daisy_test_payment_reopen_failure on privacy_jobs`;
        await fixture.sql`drop function daisy_test_payment_reopen_failure()`;
      }
    },
  ));
