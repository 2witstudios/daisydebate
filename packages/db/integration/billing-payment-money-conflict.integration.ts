import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { and, eq } from 'drizzle-orm';
import {
  billingPaymentObservationSchema,
  refundIdempotencyKey,
} from '@daisy/protocol/billing';
import { createBoundedTransaction } from '../src/bounded-transaction';
import { createLane } from '../src/workload';
import { currentWebTransaction } from '../src/web-service-authority';
import { lockRefundAccount } from '../src/billing-refund-authority';
import { readDatabaseTime } from '../src/database-clock';
import { billingPaymentObservations } from '../src/schema/billing-payment-observations';
import { privacyJobs } from '../src/schema/privacy-jobs';
import { paymentObservationValues } from '../src/billing-payment-observation-record';
import { linkObservedRefund } from '../src/billing-observation-refund';
import { enqueuePrivacyJob } from '../src/privacy/enqueue-job';
import { createDatabase } from '../src/index';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
import { fullRead } from './billing-payment-read.test-support';
requireTestServices(process.env);
setupRitewayBun();

test('an incompatible original-charge admission retains its positive owned observation as sticky owed and preserves the sole action', async () =>
  withClosedPurchase(true, async (input) => {
    const { fixture, pool, subject, cleanup, instanceId } = input;
    const read = await fullRead(input),
      proof = read.evidence.payment;
    const { priceId, invoicePaymentId, ...payment } = proof;
    void priceId;
    void invoicePaymentId;
    const refunds = createDatabase({
      url: process.env.TEST_DATABASE_URL!,
      client: pool,
      nextActorId: createId,
    }).billingRefunds(instanceId);
    const original = await refunds.admit(subject.userId, {
      ...payment,
      period: {
        ...payment.period,
        endsAt: new Date(
          Date.parse(payment.period.endsAt) + 86400000,
        ).toISOString(),
      },
    });
    if (!('action' in original))
      throw Error('Missing deliberately incompatible original action fixture');
    const [originalRow] =
      await fixture.sql`select * from billing_refund_actions where id=${original.action.id}`;
    const [priorJob] =
      await fixture.sql`select id from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
    const run = currentWebTransaction(
      createBoundedTransaction({
        lane: createLane('control', pool, {
          connections: 6,
          queue: 64,
          maxWaitMs: 1000,
        }),
        now: performance.now,
      }),
      instanceId,
    );
    try {
      // Fault-controlled adapter ordering: retain the already-positive observation
      // before admission sees an incompatible original action. The public writer's
      // earlier optional lookup is not the final money-authority check.
      const result = await run(async (tx) => {
        const closedAt = await lockRefundAccount(tx, subject.userId);
        await tx
          .select()
          .from(privacyJobs)
          .where(
            and(
              eq(privacyJobs.subjectRef, subject.userId),
              eq(privacyJobs.vendor, 'stripe'),
            ),
          )
          .for('update');
        const now = (await readDatabaseTime(tx)).toISOString();
        const value = billingPaymentObservationSchema.parse({
          id: createId(),
          userId: subject.userId,
          kind: 'payment',
          mode: read.mode,
          customerId: read.customerId,
          invoiceId: read.invoiceId,
          invoicePaymentId: read.invoicePaymentId,
          source: read.source,
          closedAt,
          createdAt: now,
          observedAt: now,
          refundActionId: null,
          state: {
            kind: 'owed',
            reason: 'refund_required',
            evidence: read.evidence,
          },
        });
        await tx
          .insert(billingPaymentObservations)
          .values(paymentObservationValues(value));
        const retained = await linkObservedRefund(tx, value, {
          context: { userId: subject.userId, closedAt, now },
          nextId: createId,
        });
        await enqueuePrivacyJob(tx, {
          id: createId(),
          subjectRef: subject.userId,
          vendor: 'stripe',
          createdAt: (await readDatabaseTime(tx)).toISOString(),
        });
        return retained;
      });
      const [job] =
        await fixture.sql`select id,status,retry_at,attempts from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
      const [row] =
        await fixture.sql`select * from billing_payment_observations where user_id=${subject.userId}`;
      const replay = await cleanup.recordPayment(subject.userId, read);
      const [after] =
        await fixture.sql`select * from billing_payment_observations where user_id=${subject.userId}`;
      const [afterJob] =
        await fixture.sql`select id,status,retry_at,attempts from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
      const actions =
        await fixture.sql`select * from billing_refund_actions where user_id=${subject.userId}`;
      assert({
        given:
          'one exact owned positive payment and an immutable charge action with incompatible original period',
        should:
          'keep the payment sticky owed and unlinked, preserve one byte-identical action/key, rotate once and leave replay unchanged',
        actual: [
          result.state,
          row!.refund_action_id,
          job!.id !== priorJob!.id,
          job!.status,
          replay,
          after,
          afterJob,
          actions,
          refundIdempotencyKey(original.action),
        ],
        expected: [
          {
            kind: 'owed',
            reason: 'conflicting_evidence',
            evidence: read.evidence,
          },
          null,
          true,
          'pending',
          'unchanged',
          row,
          job,
          [originalRow],
          `daisy-closure-refund:${original.action.id}`,
        ],
      });
      await assertRejects({
        given:
          'the existing independent refund entry receives incompatible original money for the same charge',
        should:
          'retain its previous refusal semantics and never substitute another action',
        code: 'CONFLICT',
        actual: () => refunds.admit(subject.userId, payment),
      });
    } finally {
      await fixture.sql`delete from billing_payment_observations where user_id=${subject.userId}`;
      await fixture.sql`delete from billing_refund_actions where user_id=${subject.userId}`;
    }
  }));

test('contradictory reread of an already-linked payment preserves original linked evidence and action while keeping new cleanup owed', async () =>
  withClosedPurchase(true, async (input) => {
    const { fixture, subject, cleanup } = input;
    const read = await fullRead(input);
    try {
      await cleanup.recordPayment(subject.userId, read);
      const [original] =
        await fixture.sql`select * from billing_payment_observations where user_id=${subject.userId}`;
      const actions =
        await fixture.sql`select * from billing_refund_actions where user_id=${subject.userId}`;
      const [prior] =
        await fixture.sql`select id from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
      const contradictory = {
        ...read,
        evidence: {
          kind: 'verified',
          payment: {
            ...read.evidence.payment,
            period: {
              ...read.evidence.payment.period,
              endsAt: new Date(
                Date.parse(read.evidence.payment.period.endsAt) + 86400000,
              ).toISOString(),
            },
          },
        },
      };
      const result = await cleanup.recordPayment(subject.userId, contradictory);
      const [conflict] =
        await fixture.sql`select * from billing_payment_observations where user_id=${subject.userId}`;
      const [job] =
        await fixture.sql`select id,status,retry_at,attempts from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
      const replay = await cleanup.recordPayment(subject.userId, contradictory);
      const [after] =
        await fixture.sql`select * from billing_payment_observations where user_id=${subject.userId}`;
      const [afterJob] =
        await fixture.sql`select id,status,retry_at,attempts from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
      const afterActions =
        await fixture.sql`select * from billing_refund_actions where user_id=${subject.userId}`;
      assert({
        given:
          'an existing linked exact-charge observation followed by contradictory period evidence for the same payment',
        should:
          'retain original bound action/evidence as sticky owed, reopen once, never replace money authority and make replay byte-identical',
        actual: [
          result,
          conflict!.id,
          conflict!.refund_action_id,
          conflict!.source,
          conflict!.state,
          job!.id !== prior!.id,
          job!.status,
          replay,
          after,
          afterJob,
          afterActions,
          refundIdempotencyKey({ id: afterActions[0]!.id }),
        ],
        expected: [
          'recorded',
          original!.id,
          original!.refund_action_id,
          original!.source,
          {
            kind: 'owed',
            reason: 'conflicting_evidence',
            evidence: { kind: 'verified', payment: original!.state.payment },
          },
          true,
          'pending',
          'unchanged',
          conflict,
          job,
          actions,
          `daisy-closure-refund:${actions[0]!.id}`,
        ],
      });
    } finally {
      await fixture.sql`delete from billing_payment_observations where user_id=${subject.userId}`;
      await fixture.sql`delete from billing_refund_actions where user_id=${subject.userId}`;
    }
  }));
