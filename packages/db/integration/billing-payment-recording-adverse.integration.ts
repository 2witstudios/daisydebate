import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assertRejects } from '@daisy/errors/testing';
import { createDatabase } from '../src/index';
import {
  completeControlledStripeCleanup,
  finishedOrBlockedBehind,
} from '../src/testing';
import { withBillingRefunds } from './billing-refunds.test-support';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
import { loseTransactionCommitReply } from './bounded-transaction.test-support';
requireTestServices(process.env);
setupRitewayBun();
const read = (customerId: string) => ({
  mode: 'test',
  customerId,
  invoiceId: `in_${createId()}`,
  invoicePaymentId: `inpay_${createId()}`,
  source: { kind: 'unresolved', vendorSubscriptionId: null, priceId: null },
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
});

test(
  'a new exact late payment after a typed prior acknowledgement atomically reopens cleanup without recreating its deleted customer',
  async () =>
    withBillingRefunds(async (input) => {
      const { fixture, pool, instanceId, userId, vendorCustomerId } = input;
      const reserve = pool.reserve.bind(pool);
      pool.reserve = async (options) => {
        const connection = await reserve(options);
        await connection`set role daisy_web`;
        return connection;
      };
      const database = createDatabase({
        url: process.env.TEST_DATABASE_URL!,
        client: pool,
        nextActorId: createId,
      });
      const cleanup = database.billingCleanup(instanceId);
      const retained = await settledRefundRouting(input);
      await completeControlledStripeCleanup({
        owner: fixture.sql,
        database,
        userId,
        instanceId,
      });
      const [prior] =
        await fixture.sql`select id,status,billing_cleanup->>'kind' as kind from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
      const payment = read(vendorCustomerId);
      try {
        const result = await cleanup.recordPayment(userId, payment);
        const duplicate = await cleanup.recordPayment(userId, payment);
        const [after] =
          await fixture.sql`select id,status,billing_cleanup from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
        const [counts] =
          await fixture.sql`select (select count(*)::int from billing_payment_observations where user_id=${userId}) as observations,(select count(*)::int from billing_customers where user_id=${userId}) as customers`;
        assert({
          given:
            'a controlled typed vendor-deleted ACK completed before newly verified owed payment identity',
          should:
            'commit the fact with a fresh pending job once, retain no-customer routing and keep duplicate idle',
          actual: [
            prior!.status,
            prior!.kind,
            result,
            duplicate,
            after!.id !== prior!.id,
            after!.status,
            after!.billing_cleanup,
            counts,
            (
              await fixture.sql`select to_jsonb(action) as value from billing_refund_actions action where id=${retained.id}`
            )[0]!.value,
          ],
          expected: [
            'succeeded',
            'acknowledged',
            'recorded',
            'unchanged',
            true,
            'pending',
            null,
            { observations: 1, customers: 0 },
            retained,
          ],
        });
      } finally {
        await fixture.sql`delete from billing_payment_observations where user_id=${userId}`;
        pool.reserve = reserve;
      }
    }),
  15000,
);

test('concurrent exact payment recognition and lost commit reply converge on one observation and one reopened job', async () =>
  withClosedPurchase(
    true,
    async ({ fixture, pool, subject, session, cleanup, renew }) => {
      const payment = read(session.customerId);
      try {
        const race = await Promise.all([
          cleanup.recordPayment(subject.userId, payment),
          cleanup.recordPayment(subject.userId, payment),
        ]);
        const [first] =
          await fixture.sql`select * from billing_payment_observations where user_id=${subject.userId}`;
        const [job] =
          await fixture.sql`select id,retry_at,attempts from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
        const stronger = {
          ...payment,
          evidence: {
            kind: 'partial',
            facts: { ...payment.evidence.facts, status: 'open' },
          },
        };
        const restore = loseTransactionCommitReply(pool, 2);
        try {
          await assertRejects({
            given:
              'a committed strengthened payment fact and new job whose commit acknowledgement is lost',
            should: 'report honest uncertainty while durable facts survive',
            code: 'INFRASTRUCTURE',
            actual: () => cleanup.recordPayment(subject.userId, stronger),
          });
        } finally {
          restore();
        }
        const [committed] =
          await fixture.sql`select * from billing_payment_observations where user_id=${subject.userId}`;
        const [newJob] =
          await fixture.sql`select id,retry_at,attempts from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
        await renew();
        const replay = await cleanup.recordPayment(subject.userId, stronger);
        const [after] =
          await fixture.sql`select * from billing_payment_observations where user_id=${subject.userId}`;
        const [afterJob] =
          await fixture.sql`select id,retry_at,attempts from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
        assert({
          given:
            'duplicate admission followed by lost response and recovery of one real new positive status fact',
          should:
            'retain one original identity, reopen once per new knowledge and preserve exact replay recognition and retry state',
          actual: [
            race.sort(),
            committed!.id,
            committed!.state.evidence.facts.status,
            newJob!.id !== job!.id,
            replay,
            after,
            afterJob,
          ],
          expected: [
            ['recorded', 'unchanged'],
            first!.id,
            'open',
            true,
            'unchanged',
            committed,
            newJob,
          ],
        });
      } finally {
        await fixture.sql`delete from billing_payment_observations where user_id=${subject.userId}`;
      }
    },
  ));

test('service authority lost behind the payment table lock rolls back both recognition and job reopening', async () =>
  withClosedPurchase(
    true,
    async ({ fixture, subject, session, cleanup, instanceId, jobId }) => {
      const holder = await fixture.sql.reserve();
      let observed: Promise<unknown> | undefined;
      try {
        await holder`begin`;
        await holder`lock table billing_payment_observations in share mode`;
        const [pid] = await holder`select pg_backend_pid() as pid`;
        const pending = cleanup.recordPayment(
          subject.userId,
          read(session.customerId),
        );
        observed = Promise.allSettled([pending]);
        const blocked = await finishedOrBlockedBehind(
          pending,
          fixture.sql,
          Number(pid!.pid),
          { now: performance.now, deadlineMs: 500 },
        );
        assert({
          given:
            'a current service payment writer waiting on an actual observation INSERT lock',
          should:
            'reach and block behind the controlled lock before service expiration',
          actual: blocked,
          expected: 'blocked',
        });
        await fixture.sql`update service_instances set renewed_at=clock_timestamp()-interval '4 seconds' where instance_id=${instanceId}`;
        await holder`commit`;
        await assertRejects({
          given:
            'service authority expires while the new observation INSERT is waiting',
          should:
            'refuse final service authority and rollback both observed fact and reopened job',
          code: 'AUTHORIZATION',
          actual: () => pending,
        });
        const rows =
          await fixture.sql`select id from billing_payment_observations where user_id=${subject.userId}`;
        const [job] =
          await fixture.sql`select id from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
        assert({
          given: 'failed final service check after both writes were attempted',
          should: 'preserve the original job and leave no partial new fact',
          actual: [rows.length, job!.id],
          expected: [0, jobId],
        });
      } finally {
        await holder`rollback`;
        holder.release();
        await observed;
      }
    },
  ));

/** Controlled positive vendor refund result retains original routing after customer removal. */
async function settledRefundRouting(
  input: Parameters<Parameters<typeof withBillingRefunds>[0]>[0],
) {
  const admitted = await input.refunds.admit(input.userId, input.payment);
  if (!('action' in admitted)) throw Error('Fixture original refund refused');
  const claimed = await input.refunds.claim(admitted.action.id);
  if (claimed?.work !== 'create' || !claimed.action.claim)
    throw Error('Missing original refund claim');
  await input.refunds.record(admitted.action.id, {
    kind: 'observe',
    claimId: claimed.action.claim.id,
    refundId: `re_${createId()}`,
    status: 'succeeded',
  });
  const [row] = await input.fixture
    .sql`select to_jsonb(action) as value from billing_refund_actions action where id=${admitted.action.id}`;
  if (
    row?.value.state.kind !== 'known' ||
    row.value.state.status !== 'succeeded'
  )
    throw Error('Missing positively settled original refund routing');
  return row.value;
}
